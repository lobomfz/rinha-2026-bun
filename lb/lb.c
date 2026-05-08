  #define _GNU_SOURCE
  #include <stdio.h>
  #include <stdlib.h>
  #include <string.h>
  #include <unistd.h>
  #include <fcntl.h>
  #include <errno.h>
  #include <signal.h>
  #include <stdint.h>
  #include <sys/socket.h>
  #include <sys/un.h>
  #include <netinet/in.h>
  #include <netinet/tcp.h>
  #include <sys/epoll.h>

  #define LISTEN_PORT 9999
  #define MAX_FDS     65536
  #define BUF_SIZE    4096
  #define MAX_EVENTS  128

  #define ROLE_LISTEN   0
  #define ROLE_CLIENT   1
  #define ROLE_UPSTREAM 2

  typedef struct {
      uint8_t  role;
      int      peer_fd;
      uint8_t *pending;
      size_t   pending_len;
      size_t   pending_off;
  } Conn;

  static Conn conns[MAX_FDS];
  static int  epfd;
  static const char *upstreams[] = {
      "/sockets/api1.sock",
      "/sockets/api2.sock",
  };
  static unsigned next_upstream;

  static void die(const char *m) { perror(m); exit(1); }

  static int epoll_arm(int fd, uint32_t events) {
      struct epoll_event ev = { .events = events, .data.fd = fd };
      return epoll_ctl(epfd, EPOLL_CTL_ADD, fd, &ev);
  }

  static int epoll_rearm(int fd, uint32_t events) {
      struct epoll_event ev = { .events = events, .data.fd = fd };
      return epoll_ctl(epfd, EPOLL_CTL_MOD, fd, &ev);
  }

  static int connect_upstream(void) {
      int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
      if (fd < 0) return -1;
      struct sockaddr_un addr = {0};
      addr.sun_family = AF_UNIX;
      strncpy(addr.sun_path, upstreams[next_upstream++ & 1u],
  sizeof(addr.sun_path) - 1);
      if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0 && errno !=
  EINPROGRESS) {
          close(fd);
          return -1;
      }
      return fd;
  }

  static void close_conn(int fd) {
      int peer = conns[fd].peer_fd;
      epoll_ctl(epfd, EPOLL_CTL_DEL, fd, NULL);
      close(fd);
      free(conns[fd].pending);
      conns[fd] = (Conn){ .role = ROLE_LISTEN, .peer_fd = -1 };
      if (peer >= 0 && conns[peer].peer_fd == fd) {
          epoll_ctl(epfd, EPOLL_CTL_DEL, peer, NULL);
          close(peer);
          free(conns[peer].pending);
          conns[peer] = (Conn){ .role = ROLE_LISTEN, .peer_fd = -1 };
      }
  }

  static int flush_pending(int fd) {
      Conn *c = &conns[fd];
      while (c->pending_off < c->pending_len) {
          ssize_t w = send(fd, c->pending + c->pending_off,
                           c->pending_len - c->pending_off, MSG_NOSIGNAL);
          if (w > 0) { c->pending_off += w; continue; }
          if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return 1;
          return -1;
      }
      free(c->pending);
      c->pending = NULL;
      c->pending_len = c->pending_off = 0;
      return 0;
  }

  static void forward(int src_fd) {
      int dst_fd = conns[src_fd].peer_fd;
      if (dst_fd < 0) return;

      uint8_t buf[BUF_SIZE];
      for (;;) {
          ssize_t n = recv(src_fd, buf, BUF_SIZE, 0);
          if (n == 0) { close_conn(src_fd); return; }
          if (n < 0) {
              if (errno == EAGAIN || errno == EWOULDBLOCK) return;
              close_conn(src_fd);
              return;
          }

          Conn *dst = &conns[dst_fd];
          if (dst->pending) {
              uint8_t *grown = realloc(dst->pending, dst->pending_len + n);
              if (!grown) { close_conn(src_fd); return; }
              memcpy(grown + dst->pending_len, buf, n);
              dst->pending = grown;
              dst->pending_len += n;
              continue;
          }

          ssize_t off = 0;
          while (off < n) {
              ssize_t w = send(dst_fd, buf + off, n - off, MSG_NOSIGNAL);
              if (w > 0) { off += w; continue; }
              if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
                  size_t rem = n - off;
                  dst->pending = malloc(rem);
                  if (!dst->pending) { close_conn(src_fd); return; }
                  memcpy(dst->pending, buf + off, rem);
                  dst->pending_len = rem;
                  dst->pending_off = 0;
                  epoll_rearm(dst_fd, EPOLLIN | EPOLLOUT | EPOLLET |
  EPOLLRDHUP);
                  return;
              }
              close_conn(src_fd);
              return;
          }
      }
  }

  static void on_accept(int listen_fd) {
      for (;;) {
          int cfd = accept4(listen_fd, NULL, NULL, SOCK_NONBLOCK |
  SOCK_CLOEXEC);
          if (cfd < 0) return;

          int one = 1;
          setsockopt(cfd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
  #ifdef TCP_QUICKACK
          setsockopt(cfd, IPPROTO_TCP, TCP_QUICKACK, &one, sizeof(one));
  #endif

          int ufd = connect_upstream();
          if (ufd < 0) { close(cfd); continue; }

          conns[cfd] = (Conn){ .role = ROLE_CLIENT,   .peer_fd = ufd };
          conns[ufd] = (Conn){ .role = ROLE_UPSTREAM, .peer_fd = cfd };

          epoll_arm(cfd, EPOLLIN | EPOLLET | EPOLLRDHUP);
          epoll_arm(ufd, EPOLLIN | EPOLLET | EPOLLRDHUP);
      }
  }

  int main(void) {
      signal(SIGPIPE, SIG_IGN);

      int lfd = socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
      if (lfd < 0) die("socket");
      int one = 1;
      setsockopt(lfd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

      struct sockaddr_in addr = { .sin_family = AF_INET,
                                  .sin_port = htons(LISTEN_PORT),
                                  .sin_addr.s_addr = INADDR_ANY };
      if (bind(lfd, (struct sockaddr *)&addr, sizeof(addr)) < 0) die("bind");
      if (listen(lfd, 4096) < 0) die("listen");

      epfd = epoll_create1(EPOLL_CLOEXEC);
      if (epfd < 0) die("epoll_create1");

      for (int i = 0; i < MAX_FDS; i++) conns[i].peer_fd = -1;

      conns[lfd].role = ROLE_LISTEN;
      epoll_arm(lfd, EPOLLIN);

      struct epoll_event events[MAX_EVENTS];
      for (;;) {
          int n = epoll_wait(epfd, events, MAX_EVENTS, -1);
          if (n < 0) { if (errno == EINTR) continue; die("epoll_wait"); }

          for (int i = 0; i < n; i++) {
              int fd = events[i].data.fd;
              uint32_t ev = events[i].events;

              if (conns[fd].role == ROLE_LISTEN) { on_accept(fd); continue; }

              if (ev & EPOLLOUT) {
                  int rc = flush_pending(fd);
                  if (rc < 0) { close_conn(fd); continue; }
                  if (rc == 0) epoll_rearm(fd, EPOLLIN | EPOLLET | EPOLLRDHUP);
              }
              if (ev & EPOLLIN) forward(fd);
              if (ev & (EPOLLERR | EPOLLHUP | EPOLLRDHUP)) close_conn(fd);
          }
      }
  }