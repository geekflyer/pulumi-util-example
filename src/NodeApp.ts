import { App, AppProps } from './App';
import * as pulumi from '@pulumi/pulumi';
import * as assert from 'assert';
import { cloneDeep, set } from 'lodash';

export class NodeApp extends App {
  constructor(args: AppProps, opts?: pulumi.ComponentResourceOptions) {
    // Node apps make sure that an NPM_TOKEN exists
    if (!args.docker || !args.docker.buildArgs || !args.docker.buildArgs.NPM_TOKEN) {
      const { NPM_TOKEN } = process.env;
      assert.ok(NPM_TOKEN != null, `Required environment variable NPM_TOKEN is missing.`);

      args = cloneDeep(args);
      set(args, 'docker.buildArgs.NPM_TOKEN', NPM_TOKEN);
    }

    super(args, opts);
  }
}
