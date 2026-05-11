#ifndef RINHA_PROFILE_H
#define RINHA_PROFILE_H

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#ifdef PROFILE
void profile_install_signal_handlers(void);
int profile_drain_requested(void);
void profile_on_accept(int client_fd);
void profile_on_client_recv(int client_fd, ssize_t n);
void profile_on_upstream_recv(int client_fd, ssize_t n);
void profile_on_upstream_send_done(int client_fd);
void profile_on_client_send_done(int client_fd);
uint8_t *profile_with_trace_header(int client_fd, const uint8_t *buf, size_t len, size_t *out_len);
#else
static inline void profile_install_signal_handlers(void) {}

static inline int profile_drain_requested(void) {
    return 0;
}

static inline void profile_on_accept(int client_fd) {
    (void)client_fd;
}

static inline void profile_on_client_recv(int client_fd, ssize_t n) {
    (void)client_fd;
    (void)n;
}

static inline void profile_on_upstream_recv(int client_fd, ssize_t n) {
    (void)client_fd;
    (void)n;
}

static inline void profile_on_upstream_send_done(int client_fd) {
    (void)client_fd;
}

static inline void profile_on_client_send_done(int client_fd) {
    (void)client_fd;
}

static inline uint8_t *profile_with_trace_header(int client_fd, const uint8_t *buf, size_t len,
                                                 size_t *out_len) {
    (void)client_fd;
    (void)buf;
    (void)len;
    (void)out_len;
    return NULL;
}
#endif

#endif
