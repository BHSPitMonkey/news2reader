FROM node:18

LABEL org.opencontainers.image.source=https://github.com/BHSPitMonkey/news2reader
LABEL org.opencontainers.image.description=" Serve online articles directly to your e-reader using OPDS"
LABEL org.opencontainers.image.licenses=MIT

WORKDIR /usr/src/app
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable
COPY dist/ ./dist/

EXPOSE 8080
CMD [ "yarn", "start" ]