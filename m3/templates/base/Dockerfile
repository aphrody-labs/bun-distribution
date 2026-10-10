# Deployment image for the packed archive (build it on the target architecture):
#   bun run build:bin && bun run pack:deploy
#   docker build -t __NAME__ --build-arg ARCHIVE=dist/__NAME__-<target>.tar.gz .
FROM debian:stable-slim
ARG ARCHIVE
COPY ${ARCHIVE} /tmp/app.tar.gz
RUN mkdir -p /opt/__NAME__ && tar -xzf /tmp/app.tar.gz -C /opt/__NAME__ --strip-components=1 && rm /tmp/app.tar.gz
ENV PORT=3000 DB_PATH=/data/app.sqlite
VOLUME /data
EXPOSE 3000
CMD ["/opt/__NAME__/run.sh"]
