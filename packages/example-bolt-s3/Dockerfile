FROM public.ecr.aws/lambda/nodejs:20 as builder
LABEL stage=builder

WORKDIR /usr/app

ENV NPM_CONFIG_UPDATE_NOTIFIER false

COPY ./ /usr/app
RUN npm install
RUN npm -w packages/bolt-s3 run compile
RUN npm -w packages/example-bolt-s3 run build

FROM public.ecr.aws/lambda/nodejs:20

WORKDIR ${LAMBDA_TASK_ROOT}
COPY --from=builder /usr/app/packages/example-bolt-s3/build/* ./

CMD ["index.handler"]
