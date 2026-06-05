ARG LLVM_VERSION=21
ARG OLD_BUN_VERSION=1.3.13
ARG NODE_VERSION=24.3.0
ARG CMAKE_VERSION=3.30.5

FROM ubuntu:20.04 AS builder

ARG LLVM_VERSION
ARG OLD_BUN_VERSION
ARG NODE_VERSION
ARG CMAKE_VERSION

ENV DEBIAN_FRONTEND=noninteractive \
    CI=true \
    DOCKER=true

RUN echo 'Acquire::Queue-Mode "host";' > /etc/apt/apt.conf.d/99-apt-queue-mode.conf \
    && echo 'Acquire::Retries "3";' > /etc/apt/apt.conf.d/99-apt-retries.conf \
    && echo 'APT::Install-Recommends "false";' > /etc/apt/apt.conf.d/99-apt-recommends.conf \
    && echo 'APT::Install-Suggests "false";' > /etc/apt/apt.conf.d/99-apt-suggests.conf

RUN apt-get update && apt-get install -y --no-install-recommends \
        wget curl git python3 ninja-build \
        software-properties-common apt-transport-https \
        ca-certificates gnupg lsb-release unzip xz-utils \
        libxml2-dev ruby ruby-dev bison gawk perl make golang ccache \
    && add-apt-repository ppa:ubuntu-toolchain-r/test \
    && apt-get update \
    && apt-get install -y gcc-13 g++-13 libgcc-13-dev libstdc++-13-dev \
        libgfortran5 libc6-dev \
    && wget https://apt.llvm.org/llvm.sh \
    && chmod +x llvm.sh \
    && ./llvm.sh ${LLVM_VERSION} all \
    && rm llvm.sh \
    && rm -rf /var/lib/apt/lists/*

RUN wget -O /tmp/cmake.sh "https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-linux-x86_64.sh" \
    && sh /tmp/cmake.sh --skip-license --prefix=/usr \
    && rm /tmp/cmake.sh

RUN update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-13 130 \
    --slave /usr/bin/g++ g++ /usr/bin/g++-13 \
    --slave /usr/bin/gcc-ar gcc-ar /usr/bin/gcc-ar-13 \
    --slave /usr/bin/gcc-nm gcc-nm /usr/bin/gcc-nm-13 \
    --slave /usr/bin/gcc-ranlib gcc-ranlib /usr/bin/gcc-ranlib-13

ENV LD_LIBRARY_PATH=/usr/lib/gcc/x86_64-linux-gnu/13:/usr/lib/x86_64-linux-gnu \
    LIBRARY_PATH=/usr/lib/gcc/x86_64-linux-gnu/13:/usr/lib/x86_64-linux-gnu \
    CPLUS_INCLUDE_PATH=/usr/include/c++/13:/usr/include/x86_64-linux-gnu/c++/13

RUN mkdir -p /usr/lib/gcc/x86_64-linux-gnu/13 \
    && ln -sf /usr/lib/x86_64-linux-gnu/libstdc++.so.6 /usr/lib/gcc/x86_64-linux-gnu/13/ \
    && echo "/usr/lib/gcc/x86_64-linux-gnu/13" > /etc/ld.so.conf.d/gcc-13.conf \
    && echo "/usr/lib/x86_64-linux-gnu" >> /etc/ld.so.conf.d/gcc-13.conf \
    && ldconfig

RUN for f in /usr/lib/llvm-${LLVM_VERSION}/bin/*; do ln -sf "$f" /usr/bin; done \
    && ln -sf /usr/bin/clang-${LLVM_VERSION} /usr/bin/clang \
    && ln -sf /usr/bin/clang++-${LLVM_VERSION} /usr/bin/clang++ \
    && ln -sf /usr/bin/lld-${LLVM_VERSION} /usr/bin/lld \
    && ln -sf /usr/bin/lldb-${LLVM_VERSION} /usr/bin/lldb \
    && ln -sf /usr/bin/clangd-${LLVM_VERSION} /usr/bin/clangd \
    && ln -sf /usr/bin/llvm-ar-${LLVM_VERSION} /usr/bin/llvm-ar \
    && ln -sf /usr/bin/ld.lld /usr/bin/ld \
    && ln -sf /usr/bin/clang /usr/bin/cc \
    && ln -sf /usr/bin/clang++ /usr/bin/c++

ENV CC=clang \
    CXX=clang++ \
    AR=llvm-ar-${LLVM_VERSION} \
    RANLIB=llvm-ranlib-${LLVM_VERSION} \
    LD=lld-${LLVM_VERSION}

RUN curl -fsSL "https://pub-5e11e972747a44bf9aaf9394f185a982.r2.dev/releases/bun-v${OLD_BUN_VERSION}/bun-linux-x64.zip" -o /tmp/bun.zip \
    && unzip /tmp/bun.zip -d /tmp/bun \
    && mv /tmp/bun/*/bun /usr/bin/bun \
    && chmod +x /usr/bin/bun \
    && rm -rf /tmp/bun /tmp/bun.zip

RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" \
        | tar -xz -C /usr/local --strip-components=1 \
    && node --version

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain none
ENV PATH=/root/.cargo/bin:$PATH

WORKDIR /workspace/bun
COPY bun-custom/source /workspace/bun

RUN rustup show

ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

RUN JOBS=4; \
    echo "==> building with $JOBS jobs (host nproc=$(nproc))" \
    && CMAKE_BUILD_PARALLEL_LEVEL=$JOBS \
       CARGO_BUILD_JOBS=$JOBS \
       MAKEFLAGS=-j$JOBS \
       bun run build:release \
    && mkdir -p /target \
    && cp build/release/bun /target/bun \
    && chmod +x /target/bun


FROM debian:trixie-slim AS bun-binary
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /target/bun /target/bun
RUN ln -sf /target/bun /usr/local/bin/bun
ENTRYPOINT ["/target/bun"]
