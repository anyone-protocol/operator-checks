# BUILD
FROM node:18.16-alpine As build

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./

RUN npm ci

COPY --chown=node:node . .

RUN npm run build

ENV NODE_ENV production

RUN npm ci --only=production && npm cache clean --force

USER node

# PRODUCTION
FROM node:18.16-alpine As production

WORKDIR /app

COPY --chown=node:node --from=build /usr/src/app/node_modules /app/node_modules
COPY --chown=node:node --from=build /usr/src/app/dist /app/dist

CMD [ "node", "/app/dist/main.js" ]
