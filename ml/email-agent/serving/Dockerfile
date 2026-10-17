# Keep only the upstream CPU executable/backends; omit unused CUDA/ROCm libraries.
FROM ollama/ollama:0.12.3 AS upstream
FROM node:22-alpine AS utilities
FROM scratch
COPY --from=upstream /lib/x86_64-linux-gnu/libstdc++.so.6* /lib/x86_64-linux-gnu/
COPY --from=upstream /lib/x86_64-linux-gnu/libgcc_s.so.1 /lib/x86_64-linux-gnu/libgcc_s.so.1
COPY --from=upstream /lib/x86_64-linux-gnu/libc.so.6 /lib/x86_64-linux-gnu/libc.so.6
COPY --from=upstream /lib/x86_64-linux-gnu/libm.so.6 /lib/x86_64-linux-gnu/libm.so.6
COPY --from=upstream /lib/x86_64-linux-gnu/libresolv.so.2 /lib/x86_64-linux-gnu/libresolv.so.2
COPY --from=upstream /lib/x86_64-linux-gnu/libpthread.so.0 /lib/x86_64-linux-gnu/libpthread.so.0
COPY --from=upstream /lib/x86_64-linux-gnu/librt.so.1 /lib/x86_64-linux-gnu/librt.so.1
COPY --from=upstream /lib/x86_64-linux-gnu/libdl.so.2 /lib/x86_64-linux-gnu/libdl.so.2
COPY --from=upstream /lib64/ld-linux-x86-64.so.2 /lib64/ld-linux-x86-64.so.2
COPY --from=utilities /bin/busybox /bin/busybox
COPY --from=utilities /lib/ld-musl-x86_64.so.1 /lib/ld-musl-x86_64.so.1
COPY --from=upstream /etc/ssl/certs/ /etc/ssl/certs/
COPY --from=upstream /usr/bin/ollama /usr/bin/ollama
COPY --from=upstream /usr/lib/ollama/*.so /usr/lib/ollama/
ENV PATH=/usr/bin:/bin HOME=/root LD_LIBRARY_PATH=/usr/lib/ollama OLLAMA_HOST=0.0.0.0:11434 OLLAMA_MODELS=/models
RUN ["/bin/busybox", "--install", "-s", "/bin"]
RUN mkdir -p /tmp /root/.ollama /models && chmod 1777 /tmp
RUN ollama --version
EXPOSE 11434
ENTRYPOINT ["ollama"]
CMD ["serve"]
