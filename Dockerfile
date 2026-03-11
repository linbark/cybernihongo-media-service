FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8786
ENV HTTP_PROXY= \
    HTTPS_PROXY= \
    ALL_PROXY= \
    http_proxy= \
    https_proxy= \
    all_proxy= \
    NO_PROXY= \
    no_proxy=

COPY package*.json ./
RUN HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= http_proxy= https_proxy= all_proxy= NO_PROXY= no_proxy= npm ci --omit=dev --no-audit --no-fund

COPY . ./
RUN chmod +x ./start.sh ./deploy/cloudbase/start.sh ./deploy/cloudbase/deploy.sh

EXPOSE 8786
CMD ["sh", "./deploy/cloudbase/start.sh"]
