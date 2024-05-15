FROM node:21

WORKDIR /db-app

COPY package*.json ./

RUN npm install

COPY . /db-app

EXPOSE 4002

CMD [ "npm", "start" ]