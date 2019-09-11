import * as pulumi from '@pulumi/pulumi';
import { packageName } from './constants';
import { core } from '@pulumi/kubernetes/types/input';
import { Input } from '@pulumi/pulumi';

export const context = {
  get inferredEnvironment(): string {
    return pulumi.runtime
      .getStack()!
      .split('-')
      .pop() as string;
  },
  get inferredNamespace(): string {
    return `acme-${this.inferredEnvironment}`;
  }
};

export const packageConfig = new pulumi.Config(packageName);
/**
 * Turns a map / JS object of key-value pairs, whose key is an environment variable, and whose value is the value of the environment variable, into list of
 * of environment variables in the format that typical kubernetes objects expect them.
 */
export function envFromMap(envMap: { [name: string]: Input<string> }): core.v1.EnvVar[] {
  return Object.entries(envMap).map(([name, value]) => ({ name, value }));
}
