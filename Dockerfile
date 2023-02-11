FROM node:16
RUN apt-get update \
    && apt-get install default-jre -y \
    && apt-get install default-jdk -y \
    && apt-get install openjdk-11-jdk -y 

ENV JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64
# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .

EXPOSE 8080
CMD [ "node", "app.js" ]