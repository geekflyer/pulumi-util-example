FROM node:10

ARG NPM_TOKEN

WORKDIR /app

COPY package.json package-lock.json ./
RUN echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" >> ~/.npmrc && npm install

ENV TS_NODE_TRANSPILE_ONLY=true \
    APP__NOCLUSTER=true

# We use the * patterns for files / directories that may or not may exist (this is workaround for dockerfile's limitations obviously)
# see http://redgreenrepeat.com/2018/04/13/how-to-conditionally-copy-file-in-dockerfile/ for an explanation on this hack.
COPY package.json package-lock.json* tsconfig**.json ./
COPY conf* config* conf/
COPY conf* config* config/
COPY src src

ENTRYPOINT npm start
