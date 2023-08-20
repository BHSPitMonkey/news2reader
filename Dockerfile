FROM node:20

LABEL org.opencontainers.image.source=https://github.com/BHSPitMonkey/news2reader
LABEL org.opencontainers.image.description=" Serve online articles directly to your e-reader using OPDS"
LABEL org.opencontainers.image.licenses=MIT

WORKDIR /usr/src/app
COPY package.json yarn.lock ./

# Note: The node:18 image ships with Yarn 1.x, not 2/3
RUN yarn install --immutable --network-timeout 600000
COPY dist/ ./dist/

EXPOSE 8080
CMD [ "yarn", "start" ]