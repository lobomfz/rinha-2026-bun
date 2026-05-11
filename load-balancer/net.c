#define _GNU_SOURCE
#include "lb.h"
#include "profile.h"

#include <errno.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

int epoll_arm(int fd, uint32_t events) {
    struct epoll_event ev = {.events = events, .data.fd = fd};
    return epoll_ctl(epfd, EPOLL_CTL_ADD, fd, &ev);
}

int epoll_rearm(int fd, uint32_t events) {
    struct epoll_event ev = {.events = events, .data.fd = fd};
    return epoll_ctl(epfd, EPOLL_CTL_MOD, fd, &ev);
}

int connect_upstream(void) {
    int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);

    if (fd < 0) {
        return -1;
    }

    struct sockaddr_un addr = {0};
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, upstreams[next_upstream++ & 1u], sizeof(addr.sun_path) - 1);

    if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0 && errno != EINPROGRESS) {
        close(fd);
        return -1;
    }

    return fd;
}

static void close_one(int fd) {
    if (fd < 0 || fd >= MAX_FDS) {
        return;
    }

    epoll_ctl(epfd, EPOLL_CTL_DEL, fd, NULL);
    close(fd);
    free(conns[fd].pending);
    conns[fd] = (Conn){.role = ROLE_LISTEN, .peer_fd = -1};
}

void close_conn(int fd) {
    int peer = conns[fd].peer_fd;

    close_one(fd);

    if (peer >= 0 && peer < MAX_FDS && conns[peer].peer_fd == fd) {
        close_one(peer);
    }
}

int flush_pending(int fd) {
    Conn *c = &conns[fd];

    while (c->pending_off < c->pending_len) {
        ssize_t w =
            send(fd, c->pending + c->pending_off, c->pending_len - c->pending_off, MSG_NOSIGNAL);

        if (w > 0) {
            c->pending_off += (size_t)w;
            continue;
        }

        if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            return 1;
        }

        return -1;
    }

    free(c->pending);
    c->pending = NULL;
    c->pending_len = 0;
    c->pending_off = 0;

    if (c->role == ROLE_CLIENT) {
        profile_on_client_send_done(fd);
    } else if (c->role == ROLE_UPSTREAM) {
        profile_on_upstream_send_done(c->peer_fd);
    }

    return 0;
}

void forward(int src_fd) {
    int dst_fd = conns[src_fd].peer_fd;

    if (dst_fd < 0) {
        return;
    }

    uint8_t buf[BUF_SIZE];

    for (;;) {
        ssize_t n = recv(src_fd, buf, BUF_SIZE, 0);

        if (n == 0) {
            close_conn(src_fd);
            return;
        }

        if (n < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK) {
                return;
            }

            close_conn(src_fd);
            return;
        }

        Conn *src = &conns[src_fd];

        if (src->role == ROLE_CLIENT) {
            profile_on_client_recv(src_fd, n);
        } else if (src->role == ROLE_UPSTREAM) {
            profile_on_upstream_recv(src->peer_fd, n);
        }

        Conn *dst = &conns[dst_fd];

        if (dst->pending) {
            uint8_t *grown = realloc(dst->pending, dst->pending_len + (size_t)n);

            if (!grown) {
                close_conn(src_fd);
                return;
            }

            memcpy(grown + dst->pending_len, buf, (size_t)n);
            dst->pending = grown;
            dst->pending_len += (size_t)n;
            continue;
        }

#ifdef PROFILE
        uint8_t *profile_buf = NULL;
        const uint8_t *send_buf = buf;
        size_t send_len = (size_t)n;

        if (src->role == ROLE_CLIENT) {
            profile_buf = profile_with_trace_header(src_fd, buf, (size_t)n, &send_len);

            if (profile_buf) {
                send_buf = profile_buf;
            }
        }

        size_t off = 0;

        while (off < send_len) {
            ssize_t w = send(dst_fd, send_buf + off, send_len - off, MSG_NOSIGNAL);

            if (w > 0) {
                off += (size_t)w;
                continue;
            }

            if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
                size_t rem = send_len - off;
                dst->pending = malloc(rem);

                if (!dst->pending) {
                    free(profile_buf);
                    close_conn(src_fd);
                    return;
                }

                memcpy(dst->pending, send_buf + off, rem);
                dst->pending_len = rem;
                dst->pending_off = 0;
                epoll_rearm(dst_fd, EPOLLIN | EPOLLOUT | EPOLLET | EPOLLRDHUP);
                free(profile_buf);
                return;
            }

            free(profile_buf);
            close_conn(src_fd);
            return;
        }

        free(profile_buf);
#else
        ssize_t off = 0;

        while (off < n) {
            ssize_t w = send(dst_fd, buf + off, (size_t)(n - off), MSG_NOSIGNAL);

            if (w > 0) {
                off += w;
                continue;
            }

            if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
                size_t rem = (size_t)(n - off);
                dst->pending = malloc(rem);

                if (!dst->pending) {
                    close_conn(src_fd);
                    return;
                }

                memcpy(dst->pending, buf + off, rem);
                dst->pending_len = rem;
                dst->pending_off = 0;
                epoll_rearm(dst_fd, EPOLLIN | EPOLLOUT | EPOLLET | EPOLLRDHUP);
                return;
            }

            close_conn(src_fd);
            return;
        }
#endif

        if (dst->role == ROLE_CLIENT) {
            profile_on_client_send_done(dst_fd);
        } else if (dst->role == ROLE_UPSTREAM) {
            profile_on_upstream_send_done(dst->peer_fd);
        }
    }
}

void on_accept(int listen_fd) {
    for (;;) {
        int cfd = accept4(listen_fd, NULL, NULL, SOCK_NONBLOCK | SOCK_CLOEXEC);

        if (cfd < 0) {
            return;
        }

        if (cfd >= MAX_FDS) {
            close(cfd);
            continue;
        }

        int one = 1;
        setsockopt(cfd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
#ifdef TCP_QUICKACK
        setsockopt(cfd, IPPROTO_TCP, TCP_QUICKACK, &one, sizeof(one));
#endif

        int ufd = connect_upstream();

        if (ufd < 0 || ufd >= MAX_FDS) {
            if (ufd >= 0) {
                close(ufd);
            }

            close(cfd);
            continue;
        }

        conns[cfd] = (Conn){
            .role = ROLE_CLIENT,
            .peer_fd = ufd,
        };
        profile_on_accept(cfd);

        conns[ufd] = (Conn){
            .role = ROLE_UPSTREAM,
            .peer_fd = cfd,
        };

        if (epoll_arm(cfd, EPOLLIN | EPOLLET | EPOLLRDHUP) < 0 ||
            epoll_arm(ufd, EPOLLIN | EPOLLET | EPOLLRDHUP) < 0) {
            close_conn(cfd);
        }
    }
}
