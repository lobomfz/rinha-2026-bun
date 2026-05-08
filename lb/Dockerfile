FROM alpine:3.20 AS build
RUN apk add --no-cache gcc musl-dev
WORKDIR /src
COPY lb.c .
RUN gcc -O3 -march=x86-64-v3 -flto -static -o lb lb.c -Wl,--gc-sections

FROM scratch
COPY --from=build /src/lb /lb
ENTRYPOINT ["/lb"]
