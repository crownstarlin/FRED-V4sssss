FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY server ./server
COPY public ./public
COPY .env.example ./.env.example
EXPOSE 10000
CMD ["npm","start"]
