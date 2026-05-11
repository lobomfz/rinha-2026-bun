#define _GNU_SOURCE
#include "lb.h"
#include "profile.h"

#include <inttypes.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#if defined(__x86_64__) || defined(__i386__)
#include <x86intrin.h>
#endif

typedef struct {
    uint64_t nr_periods;
    uint64_t nr_throttled;
    uint64_t throttled_usec;
    int valid;
} CgroupStat;

static CgroupStat cgroup_baseline;

static void read_cgroup_stat(CgroupStat *out) {
    out->nr_periods = 0;
    out->nr_throttled = 0;
    out->throttled_usec = 0;
    out->valid = 0;

    FILE *f = fopen("/sys/fs/cgroup/cpu.stat", "r");

    if (!f) {
        return;
    }

    char name[64];
    uint64_t value;

    while (fscanf(f, "%63s %" SCNu64, name, &value) == 2) {
        if (strcmp(name, "nr_periods") == 0) {
            out->nr_periods = value;
        } else if (strcmp(name, "nr_throttled") == 0) {
            out->nr_throttled = value;
        } else if (strcmp(name, "throttled_usec") == 0) {
            out->throttled_usec = value;
        }
    }

    out->valid = 1;
    fclose(f);
}

#define SAMPLE_CAPACITY 256000
#define SLOWEST_CAPACITY 20
#define PERF_SAMPLE_RATE 64
#define PERF_SAMPLE_CAPACITY ((SAMPLE_CAPACITY + PERF_SAMPLE_RATE - 1) / PERF_SAMPLE_RATE)

typedef struct {
    uint64_t request_id;
    uint64_t total_ns;
    uint64_t lb_in_ns;
    uint64_t upstream_wait_ns;
    uint64_t lb_out_ns;
    uint64_t cycles;
} SlowestRequest;

static volatile sig_atomic_t emit_requested;
static volatile sig_atomic_t stop_requested;

static uint64_t next_session_id;
static uint64_t next_request_id;
static uint64_t total_sessions;
static uint64_t total_requests;
static uint64_t client_bytes_total;
static uint64_t upstream_bytes_total;
static size_t sample_count;
static size_t perf_sample_count;
static size_t slowest_count;

static uint64_t total_samples[SAMPLE_CAPACITY];
static uint64_t lb_in_samples[SAMPLE_CAPACITY];
static uint64_t upstream_wait_samples[SAMPLE_CAPACITY];
static uint64_t lb_out_samples[SAMPLE_CAPACITY];
static uint64_t perf_cycle_samples[PERF_SAMPLE_CAPACITY];
static SlowestRequest slowest[SLOWEST_CAPACITY];

static const uint64_t histogram_bounds_ns[] = {
    1000,   2000,   4000,    8000,    16000,   32000,   64000,    128000,
    256000, 512000, 1000000, 2000000, 4000000, 8000000, 10000000,
};

static uint64_t now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}

static uint64_t read_cycles(void) {
#if defined(__x86_64__) || defined(__i386__)
    return __rdtsc();
#else
    return now_ns();
#endif
}

static uint64_t elapsed_after(uint64_t start, uint64_t end) {
    if (start == 0 || end <= start) {
        return 0;
    }

    return end - start;
}

static void insert_slowest(uint64_t request_id, uint64_t total_ns, uint64_t lb_in_ns,
                           uint64_t upstream_wait_ns, uint64_t lb_out_ns, uint64_t cycles) {
    SlowestRequest entry = {
        .request_id = request_id,
        .total_ns = total_ns,
        .lb_in_ns = lb_in_ns,
        .upstream_wait_ns = upstream_wait_ns,
        .lb_out_ns = lb_out_ns,
        .cycles = cycles,
    };

    if (slowest_count < SLOWEST_CAPACITY) {
        slowest[slowest_count++] = entry;
    } else if (total_ns > slowest[SLOWEST_CAPACITY - 1].total_ns) {
        slowest[SLOWEST_CAPACITY - 1] = entry;
    } else {
        return;
    }

    size_t i = slowest_count - 1;

    while (i > 0 && slowest[i - 1].total_ns < slowest[i].total_ns) {
        SlowestRequest tmp = slowest[i - 1];
        slowest[i - 1] = slowest[i];
        slowest[i] = tmp;
        i--;
    }
}

void profile_on_accept(int client_fd) {
    Conn *client = &conns[client_fd];
    uint64_t session_id = ++next_session_id;
    uint8_t perf_sampled = session_id % PERF_SAMPLE_RATE == 0;

    client->session_id = session_id;
    client->req_trace_id = 0;
    client->perf_sampled = perf_sampled;
    client->perf_started_cycles = 0;
    client->req_started_at = 0;
    client->req_upstream_sent_at = 0;
    client->req_upstream_recv_at = 0;
    total_sessions++;
}

void profile_on_client_recv(int client_fd, ssize_t n) {
    if (client_fd < 0 || client_fd >= MAX_FDS) {
        return;
    }

    Conn *c = &conns[client_fd];

    if (c->role != ROLE_CLIENT) {
        return;
    }

    client_bytes_total += (uint64_t)n;

    if (c->req_started_at != 0) {
        return;
    }

    c->req_trace_id = ++next_request_id;
    c->req_started_at = now_ns();

    if (c->perf_sampled) {
        c->perf_started_cycles = read_cycles();
    }
}

uint8_t *profile_with_trace_header(int client_fd, const uint8_t *buf, size_t len, size_t *out_len) {
    if (client_fd < 0 || client_fd >= MAX_FDS) {
        return NULL;
    }

    Conn *c = &conns[client_fd];

    if (c->role != ROLE_CLIENT || c->req_trace_id == 0) {
        return NULL;
    }

    const char marker[] = "\r\n\r\n";
    size_t header_end = len;

    for (size_t i = 0; i + sizeof(marker) - 1 <= len; i++) {
        if (memcmp(buf + i, marker, sizeof(marker) - 1) == 0) {
            header_end = i;
            break;
        }
    }

    if (header_end == len) {
        return NULL;
    }

    char trace_header[64];
    int trace_len = snprintf(trace_header, sizeof(trace_header), "\r\nX-Rinha-Trace-Id: %" PRIu64,
                             c->req_trace_id);

    if (trace_len <= 0 || (size_t)trace_len >= sizeof(trace_header)) {
        return NULL;
    }

    *out_len = len + (size_t)trace_len;
    uint8_t *out = malloc(*out_len);

    if (!out) {
        return NULL;
    }

    memcpy(out, buf, header_end);
    memcpy(out + header_end, trace_header, (size_t)trace_len);
    memcpy(out + header_end + (size_t)trace_len, buf + header_end, len - header_end);

    return out;
}

void profile_on_upstream_recv(int client_fd, ssize_t n) {
    if (client_fd < 0 || client_fd >= MAX_FDS) {
        return;
    }

    Conn *c = &conns[client_fd];

    if (c->role != ROLE_CLIENT) {
        return;
    }

    upstream_bytes_total += (uint64_t)n;

    if (c->req_started_at == 0 || c->req_upstream_recv_at != 0) {
        return;
    }

    c->req_upstream_recv_at = now_ns();
}

void profile_on_upstream_send_done(int client_fd) {
    if (client_fd < 0 || client_fd >= MAX_FDS) {
        return;
    }

    Conn *c = &conns[client_fd];

    if (c->role != ROLE_CLIENT) {
        return;
    }

    if (c->req_started_at == 0 || c->req_upstream_sent_at != 0) {
        return;
    }

    c->req_upstream_sent_at = now_ns();
}

void profile_on_client_send_done(int client_fd) {
    if (client_fd < 0 || client_fd >= MAX_FDS) {
        return;
    }

    Conn *c = &conns[client_fd];

    if (c->role != ROLE_CLIENT || c->req_started_at == 0) {
        return;
    }

    uint64_t finish = now_ns();
    uint64_t request_id = c->req_trace_id;
    uint64_t total_ns = finish - c->req_started_at;
    uint64_t lb_in_ns = elapsed_after(c->req_started_at, c->req_upstream_sent_at);
    uint64_t upstream_wait_ns = elapsed_after(c->req_upstream_sent_at, c->req_upstream_recv_at);
    uint64_t lb_out_ns = elapsed_after(c->req_upstream_recv_at, finish);
    uint64_t cycles = 0;

    total_requests++;

    if (c->perf_sampled && c->perf_started_cycles != 0 &&
        perf_sample_count < PERF_SAMPLE_CAPACITY) {
        cycles = read_cycles() - c->perf_started_cycles;
        perf_cycle_samples[perf_sample_count++] = cycles;
    }

    if (sample_count < SAMPLE_CAPACITY) {
        total_samples[sample_count] = total_ns;
        lb_in_samples[sample_count] = lb_in_ns;
        upstream_wait_samples[sample_count] = upstream_wait_ns;
        lb_out_samples[sample_count] = lb_out_ns;
        sample_count++;
    }

    insert_slowest(request_id, total_ns, lb_in_ns, upstream_wait_ns, lb_out_ns, cycles);

    c->req_started_at = 0;
    c->req_trace_id = 0;
    c->req_upstream_sent_at = 0;
    c->req_upstream_recv_at = 0;
    c->perf_started_cycles = 0;
}

static int cmp_u64(const void *a, const void *b) {
    uint64_t av = *(const uint64_t *)a;
    uint64_t bv = *(const uint64_t *)b;

    if (av < bv) {
        return -1;
    }

    if (av > bv) {
        return 1;
    }

    return 0;
}

static size_t percentile_index(size_t count, uint32_t permyriad) {
    size_t index = count * (size_t)permyriad / 10000;

    if (index >= count) {
        return count - 1;
    }

    return index;
}

static void print_summary(FILE *out, const uint64_t *samples, size_t count) {
    if (count == 0) {
        fputs("{\"count\":0,\"mean\":0,\"p50\":0,\"p95\":0,\"p99\":0,"
              "\"p999\":0,\"p9999\":0,\"max\":0,\"topN\":[]}",
              out);
        return;
    }

    uint64_t *sorted = malloc(count * sizeof(uint64_t));

    if (!sorted) {
        fputs("{\"count\":0,\"mean\":0,\"p50\":0,\"p95\":0,\"p99\":0,"
              "\"p999\":0,\"p9999\":0,\"max\":0,\"topN\":[]}",
              out);
        return;
    }

    memcpy(sorted, samples, count * sizeof(uint64_t));
    qsort(sorted, count, sizeof(uint64_t), cmp_u64);

    __uint128_t sum = 0;

    for (size_t i = 0; i < count; i++) {
        sum += sorted[i];
    }

    uint64_t mean = (uint64_t)((sum + count / 2) / count);

    fprintf(out,
            "{\"count\":%zu,\"mean\":%" PRIu64 ",\"p50\":%" PRIu64 ",\"p95\":%" PRIu64
            ",\"p99\":%" PRIu64 ",\"p999\":%" PRIu64 ",\"p9999\":%" PRIu64 ",\"max\":%" PRIu64
            ",\"topN\":[",
            count, mean, sorted[percentile_index(count, 5000)],
            sorted[percentile_index(count, 9500)], sorted[percentile_index(count, 9900)],
            sorted[percentile_index(count, 9990)], sorted[percentile_index(count, 9999)],
            sorted[count - 1]);

    size_t top_count = count < SLOWEST_CAPACITY ? count : SLOWEST_CAPACITY;

    for (size_t i = 0; i < top_count; i++) {
        if (i > 0) {
            fputc(',', out);
        }

        fprintf(out, "%" PRIu64, sorted[count - 1 - i]);
    }

    fputs("]}", out);
    free(sorted);
}

static void print_histogram(FILE *out, const uint64_t *samples, size_t count) {
    const size_t bound_count = sizeof(histogram_bounds_ns) / sizeof(histogram_bounds_ns[0]);
    uint64_t counts[sizeof(histogram_bounds_ns) / sizeof(histogram_bounds_ns[0]) + 1] = {0};

    for (size_t i = 0; i < count; i++) {
        size_t bin = 0;

        while (bin < bound_count && samples[i] >= histogram_bounds_ns[bin]) {
            bin++;
        }

        counts[bin]++;
    }

    fputs("{\"unit\":\"ns\",\"bins\":[", out);

    for (size_t i = 0; i < bound_count; i++) {
        if (i > 0) {
            fputc(',', out);
        }

        fprintf(out, "{\"ltNs\":%" PRIu64 ",\"count\":%" PRIu64 "}", histogram_bounds_ns[i],
                counts[i]);
    }

    fprintf(out, ",{\"geNs\":%" PRIu64 ",\"count\":%" PRIu64 "}]}",
            histogram_bounds_ns[bound_count - 1], counts[bound_count]);
}

static void print_cgroup_delta(FILE *out) {
    if (!cgroup_baseline.valid) {
        fputs("null", out);
        return;
    }

    CgroupStat now;
    read_cgroup_stat(&now);

    if (!now.valid) {
        fputs("null", out);
        return;
    }

    uint64_t periods = now.nr_periods - cgroup_baseline.nr_periods;
    uint64_t throttled = now.nr_throttled - cgroup_baseline.nr_throttled;
    uint64_t throttled_usec = now.throttled_usec - cgroup_baseline.throttled_usec;
    double ratio = periods > 0 ? (double)throttled / (double)periods : 0.0;

    fprintf(out,
            "{\"nr_periods\":%" PRIu64 ",\"nr_throttled\":%" PRIu64 ",\"throttled_usec\":%" PRIu64
            ",\"throttled_ratio\":%.4f}",
            periods, throttled, throttled_usec, ratio);
}

static void print_slowest(FILE *out) {
    fputc('[', out);

    for (size_t i = 0; i < slowest_count; i++) {
        const SlowestRequest *s = &slowest[i];

        if (i > 0) {
            fputc(',', out);
        }

        fprintf(out,
                "{\"id\":\"lb-%" PRIu64 "\",\"traceId\":%" PRIu64 ",\"totalNs\":%" PRIu64
                ",\"lbInNs\":%" PRIu64
                ",\"upstreamWaitNs\":%" PRIu64 ",\"lbOutNs\":%" PRIu64 ",\"cycles\":%" PRIu64 "}",
                s->request_id, s->request_id, s->total_ns, s->lb_in_ns, s->upstream_wait_ns,
                s->lb_out_ns, s->cycles);
    }

    fputc(']', out);
}

static void emit_profile(void) {
    FILE *out = stderr;

    fputs("__profile__ {\"process\":\"lb\"", out);
    fprintf(out, ",\"sessions\":%" PRIu64 ",\"requests\":%" PRIu64, total_sessions, total_requests);

    fputs(",\"phases\":{\"totalNs\":", out);
    print_summary(out, total_samples, sample_count);
    fputs(",\"lbInNs\":", out);
    print_summary(out, lb_in_samples, sample_count);
    fputs(",\"upstreamWaitNs\":", out);
    print_summary(out, upstream_wait_samples, sample_count);
    fputs(",\"lbOutNs\":", out);
    print_summary(out, lb_out_samples, sample_count);
    fputc('}', out);

    fputs(",\"histograms\":{\"totalNs\":", out);
    print_histogram(out, total_samples, sample_count);
    fputs(",\"lbInNs\":", out);
    print_histogram(out, lb_in_samples, sample_count);
    fputs(",\"upstreamWaitNs\":", out);
    print_histogram(out, upstream_wait_samples, sample_count);
    fputs(",\"lbOutNs\":", out);
    print_histogram(out, lb_out_samples, sample_count);
    fputc('}', out);

    double denom = total_requests == 0 ? 1.0 : (double)total_requests;
    fprintf(out,
            ",\"counters\":{\"clientBytesPerReq\":%.2f,\"upstreamBytesPerReq\":%.2f}"
            ",\"counterTotals\":{\"clientBytes\":%" PRIu64 ",\"upstreamBytes\":%" PRIu64 "}",
            (double)client_bytes_total / denom, (double)upstream_bytes_total / denom,
            client_bytes_total, upstream_bytes_total);

    fputs(",\"perf\":{\"sampleRate\":", out);
    fprintf(out, "%d,\"samples\":%zu,\"cycles\":", PERF_SAMPLE_RATE, perf_sample_count);
    print_summary(out, perf_cycle_samples, perf_sample_count);
    fputc('}', out);

    fputs(",\"cgroup\":", out);
    print_cgroup_delta(out);

    fputs(",\"slowest\":", out);
    print_slowest(out);
    fputs("}\n", out);
    fflush(out);
}

static void handle_signal(int sig) {
    if (sig == SIGTERM) {
        stop_requested = 1;
    }

    emit_requested = 1;
}

void profile_install_signal_handlers(void) {
    struct sigaction sa = {0};
    sa.sa_handler = handle_signal;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGUSR2, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);

    read_cgroup_stat(&cgroup_baseline);
}

int profile_drain_requested(void) {
    if (!emit_requested) {
        return 0;
    }

    emit_requested = 0;
    emit_profile();

    return !!stop_requested;
}
