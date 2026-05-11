#ifndef RINHA_LB_H
#define RINHA_LB_H

#include <stddef.h>
#include <stdint.h>

#define LISTEN_PORT 9999
#define MAX_FDS 65536
#define BUF_SIZE 4096
#define MAX_EVENTS 128

#define ROLE_LISTEN 0
#define ROLE_CLIENT 1
#define ROLE_UPSTREAM 2

typedef struct {
    uint8_t role;
#ifdef PROFILE
    uint8_t perf_sampled;
#endif
    int peer_fd;
    uint8_t *pending;
    size_t pending_len;
    size_t pending_off;
#ifdef PROFILE
    uint64_t session_id;
    uint64_t req_trace_id;
    uint64_t perf_started_cycles;
    uint64_t req_started_at;
    uint64_t req_upstream_sent_at;
    uint64_t req_upstream_recv_at;
#endif
} Conn;

extern Conn conns[MAX_FDS];
extern int epfd;
extern const char *upstreams[2];
extern unsigned next_upstream;

void die(const char *m);
int epoll_arm(int fd, uint32_t events);
int epoll_rearm(int fd, uint32_t events);
int connect_upstream(void);
void close_conn(int fd);
int flush_pending(int fd);
void forward(int src_fd);
void on_accept(int listen_fd);

#endif
