#define _GNU_SOURCE
#include "lb.h"
#include "profile.h"

#include <errno.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/epoll.h>
#include <sys/socket.h>
#include <unistd.h>

Conn conns[MAX_FDS];
int epfd;
const char *upstreams[2] = {
    "/sockets/api1.sock",
    "/sockets/api2.sock",
};
unsigned next_upstream;

void die(const char *m) {
    perror(m);
    exit(1);
}

int main(void) {
    signal(SIGPIPE, SIG_IGN);
    profile_install_signal_handlers();

    int lfd = socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);

    if (lfd < 0) {
        die("socket");
    }

    int one = 1;
    setsockopt(lfd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    struct sockaddr_in addr = {
        .sin_family = AF_INET,
        .sin_port = htons(LISTEN_PORT),
        .sin_addr.s_addr = INADDR_ANY,
    };

    if (bind(lfd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        die("bind");
    }

    if (listen(lfd, 4096) < 0) {
        die("listen");
    }

    epfd = epoll_create1(EPOLL_CLOEXEC);

    if (epfd < 0) {
        die("epoll_create1");
    }

    for (int i = 0; i < MAX_FDS; i++) {
        conns[i].peer_fd = -1;
    }

    conns[lfd].role = ROLE_LISTEN;

    if (epoll_arm(lfd, EPOLLIN) < 0) {
        die("epoll_ctl");
    }

    struct epoll_event events[MAX_EVENTS];

    for (;;) {
        if (profile_drain_requested()) {
            return 0;
        }

        int n = epoll_wait(epfd, events, MAX_EVENTS, -1);

        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }

            die("epoll_wait");
        }

        for (int i = 0; i < n; i++) {
            int fd = events[i].data.fd;
            uint32_t ev = events[i].events;

            if (conns[fd].role == ROLE_LISTEN) {
                on_accept(fd);
                continue;
            }

            if (ev & EPOLLOUT) {
                int rc = flush_pending(fd);

                if (rc < 0) {
                    close_conn(fd);
                    continue;
                }

                if (rc == 0) {
                    epoll_rearm(fd, EPOLLIN | EPOLLET | EPOLLRDHUP);
                }
            }

            if (ev & EPOLLIN) {
                forward(fd);

                if (conns[fd].role == ROLE_LISTEN) {
                    continue;
                }
            }

            if (ev & (EPOLLERR | EPOLLHUP | EPOLLRDHUP)) {
                close_conn(fd);
            }
        }
    }
}
