FROM mirror.gcr.io/library/node@sha256:9c2c405e3ff9b9afb2873232d24bb06367d649aa3e6259cbe314da59578e81e9

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
COPY node_modules ./node_modules
RUN test -f node_modules/express/index.js

COPY . ./
RUN chmod +x ./start.sh ./deploy/cloudbase/start.sh ./deploy/cloudbase/deploy.sh

EXPOSE 8786
CMD ["sh", "./deploy/cloudbase/start.sh"]
