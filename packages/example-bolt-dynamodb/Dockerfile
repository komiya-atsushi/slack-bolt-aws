FROM public.ecr.aws/lambda/nodejs:20 as builder
LABEL stage=builder

WORKDIR /usr/app

ENV NPM_CONFIG_UPDATE_NOTIFIER false

COPY ./ /usr/app
RUN npm install
RUN npm -w packages/bolt-dynamodb run compile
RUN npm -w packages/example-bolt-dynamodb run build

FROM public.ecr.aws/lambda/nodejs:20

WORKDIR ${LAMBDA_TASK_ROOT}
COPY --from=builder /usr/app/packages/example-bolt-dynamodb/build/* ./

CMD ["index.handler"]
