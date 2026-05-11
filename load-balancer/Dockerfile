FROM alpine:3.20 AS build-base
RUN apk add --no-cache gcc musl-dev
WORKDIR /src
COPY . .

FROM build-base AS build-prod
RUN gcc -O3 -march=x86-64-v3 -flto -static -o lb main.c net.c -Wl,--gc-sections

FROM build-base AS build-profile
RUN gcc -O3 -march=x86-64-v3 -flto -static -DPROFILE -o lb main.c net.c profile.c -Wl,--gc-sections

FROM scratch AS prod
COPY --from=build-prod /src/lb /lb
ENTRYPOINT ["/lb"]

FROM scratch AS profile
COPY --from=build-profile /src/lb /lb
ENTRYPOINT ["/lb"]
