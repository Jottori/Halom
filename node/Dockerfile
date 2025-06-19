FROM paritytech/ci-linux:production as builder

WORKDIR /halom
COPY . .

RUN cargo build --release

FROM ubuntu:20.04

COPY --from=builder /halom/target/release/halom-node /usr/local/bin

RUN useradd -m -u 1000 -U -s /bin/sh -d /halom halom && \
    mkdir -p /data && \
    chown -R halom:halom /data

USER halom
EXPOSE 30333 9933 9944
VOLUME ["/data"]

ENTRYPOINT ["/usr/local/bin/halom-node"]
CMD ["--dev", "--ws-external", "--rpc-external"] 