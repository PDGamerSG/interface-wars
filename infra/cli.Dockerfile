# Sandbox for the CLI arms: the Flagsmith CLI v2, jq and a shell. No curl, wget, netcat or Node.
# The container runs on the lab's internal cli-sandbox network (infra/compose.yml), whose only other member is
# the Flagsmith API, so even a raw bash /dev/tcp socket reaches nothing else. scripts/cli-isolation-check.ts
# proves this against the running lab.
FROM node:22-alpine AS cli
RUN npm install -g @flagsmith/cli@2.0.0 \
 && cp "$(find /usr/local/lib/node_modules/@flagsmith -type f -name flagsmith -path '*cli_linux*' | head -1)" /flagsmith

FROM alpine:3.21
RUN apk add --no-cache bash jq coreutils \
 && rm -f /usr/bin/wget /usr/bin/nc /bin/nc /usr/bin/ftpget /usr/bin/ftpput /usr/bin/telnet /usr/bin/ssl_client
COPY --from=cli /flagsmith /usr/local/bin/flagsmith
RUN adduser -D agent && mkdir -p /work && chown agent /work
USER agent
WORKDIR /work
ENV FLAGSMITH_NO_INPUT=1
CMD ["sleep", "infinity"]
