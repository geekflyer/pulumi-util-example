import * as docker from '@pulumi/docker';
import * as k8s from '@pulumi/kubernetes';
import * as k8stypes from '@pulumi/kubernetes/types/input';
import { core } from '@pulumi/kubernetes/types/input';
import * as pulumi from '@pulumi/pulumi';
import { Input } from '@pulumi/pulumi';
import { defaultsDeep, defaultTo, get, isObject } from 'lodash';
import { internalDomain, providerDefaults } from './gcp-constants';
import { getK8sProviderByClusterName } from './gke';
import { context, packageConfig } from './misc';
import { execSync } from 'child_process';

const bash = (cmd: string) => execSync(cmd, { encoding: 'utf8' });

const CLUSTER_INTERNAL_CA_CERTIFICATE_SECRET_NAME = 'cluster-internal-ca-certificate';
const CLUSTER_INTERNAL_CA_CERTIFICATE_MOUNT_PATH = '/var/cluster-internal-ca';
const CLUSTER_INTERNAL_CA_CERTIFICATE_FILENAME = 'ca.crt';

const gcpProjectId = new pulumi.Config('gcp').require('project');

function getImageFromEnv(): string | undefined {
  return process.env.DOCKER_IMAGE;
}

export interface AppProps {
  buildContext: string;

  env?: { [envName: string]: Input<string | core.v1.EnvVarSource> };
  /**
   * by default the dockerfile location is set to: `buildContext + '/Dockerfile'`
   */
  dockerfile?: string;
  service?: {
    internalHttpPort?: number;
    /** default is 'ClusterInternal' */
    expose?: 'ClusterInternal' | 'VPCInternal';
  };
  /**
   * If set to true a the public key of the cluster internal certification authority is auto mounted into the container under /var/cluster-internal-ca/ca.crt
   * Furthermore NODE_EXTRA_CA_CERTS is set pointing to this certificate, so that node apps running inside the cluster automatically trust certs issued by the
   * cluster internal CA.
   * Most notably elasticsearch inside the cluster uses certificates issued by the cluster internal certification authority.
   */
  mountClusterInternalCaCert?: boolean;
  environmentOverride?: string;
  nameOverride?: string;
  namespaceOverride?: string;
  imageSubPath?: string;
  imageTagOverride?: string;
  replicas?: number;
  resources?: k8stypes.core.v1.ResourceRequirements;
  livenessProbe?: core.v1.Probe;
  readinessProbe?: core.v1.Probe;
  minReadySeconds?: number;
  podDisruptionBudget?: boolean;
  docker?: {
    command?: string[];
    commandArgs?: string[];
    buildArgs?: { [key: string]: string | number | boolean };
    workingDir?: string;
  };
  podSpec?: {
    serviceAccountName?: string;
    affinity?: core.v1.Affinity;
  };
}

/**
 * App is an abstraction that uses a class to fold together the common pattern of a
 * docker image, a k8s deployment and a k8s service to give a PaaS-like experience when deploying apis
 */
export class App extends pulumi.ComponentResource {
  public readonly image?: docker.Image;
  public readonly deployment: k8s.apps.v1.Deployment;
  public readonly service?: k8s.core.v1.Service;
  public readonly ingress?: k8s.extensions.v1beta1.Ingress;
  public readonly url?: pulumi.Output<string>;

  constructor(args: AppProps, opts?: pulumi.ComponentResourceOptions) {
    let name: string;

    if (args.nameOverride) {
      name = args.nameOverride;
    } else {
      console.log('Auto-inferring app name from package.json...');
      name = require(args.buildContext + '/package.json').name;
      name = name.replace('@acme/', '');
    }

    const environment = args.environmentOverride ? args.environmentOverride : context.inferredEnvironment;

    const namespace = args.namespaceOverride ? args.namespaceOverride : `acme-${environment}`;

    console.log(`environment: ${environment}, namespace: ${namespace}`);

    let k8sProvider;
    if (!get(opts, 'providers.kubernetes')) {
      k8sProvider = getK8sProviderByClusterName(packageConfig.require('cluster'));
    }

    super(
      'acme:component:App',
      name,
      {},
      defaultsDeep(opts, { providers: { gcp: providerDefaults, kubernetes: k8sProvider } })
    );

    const gitIsDirtyFlag = bash(`git status --porcelain`) === '' ? '' : '-dirty';
    const gitSha1 = bash('git rev-parse HEAD').trim();
    const gitBranch = bash('git rev-parse --abbrev-ref HEAD').trim();
    // we assume the current user has gcloud installed since this is practically required to deploy to our k8s clusters and it's hard
    // to mess with that value.
    const currentUserEmail = bash(`gcloud config get-value core/account`).trim();

    const annotations = {
      gitSha1: gitSha1 + gitIsDirtyFlag,
      gitBranch,
      deployedBy: currentUserEmail,
      deployedAt: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    };

    const labels = { app: name };
    let buildArgs = {};
    if (args.docker && args.docker.buildArgs) {
      buildArgs = args.docker.buildArgs;
    }

    const containerPort = (args.service && args.service.internalHttpPort) || 80;

    if (!getImageFromEnv()) {
      this.image = new docker.Image(
        name,
        {
          build: {
            dockerfile: args.dockerfile || args.buildContext + '/Dockerfile',
            context: args.buildContext,
            cacheFrom: true,
            args: buildArgs
          } as any,
          imageName: `gcr.io/${gcpProjectId}/${args.imageSubPath ? args.imageSubPath + '/' : ''}${name}:${
            args.imageTagOverride ? args.imageTagOverride : 'latest'
          }`
        },
        {
          parent: this
        }
      );
    }

    const container: k8stypes.core.v1.Container = {
      name: 'main',
      image: getImageFromEnv() ? getImageFromEnv() : this.image!.imageName,
      resources: args.resources || {
        requests: { cpu: '250m', memory: '500Mi' }
      },
      livenessProbe: args.livenessProbe,
      readinessProbe: args.readinessProbe,
      env: pulumi.output(args.env).apply(env => {
        const vars = Object.entries(env || {}).map(([name, value]) => ({
          name,
          ...((isObject(value) ? { valueFrom: value } : { value }) as any)
        }));
        if (args.mountClusterInternalCaCert) {
          vars.push({
            name: 'NODE_EXTRA_CA_CERTS',
            value: CLUSTER_INTERNAL_CA_CERTIFICATE_MOUNT_PATH + '/' + CLUSTER_INTERNAL_CA_CERTIFICATE_FILENAME
          });
        }
        return vars;
      }),
      imagePullPolicy: 'IfNotPresent',
      ports: [
        {
          name: 'http',
          containerPort: containerPort
        }
      ],
      volumeMounts: args.mountClusterInternalCaCert
        ? [
            {
              name: CLUSTER_INTERNAL_CA_CERTIFICATE_SECRET_NAME,
              readOnly: true,
              mountPath: CLUSTER_INTERNAL_CA_CERTIFICATE_MOUNT_PATH
            }
          ]
        : []
    };

    // Support overriding the dockerCommand and/or dockerCommandArgs of the image
    if (args.docker) {
      if (args.docker.command) {
        container.command = args.docker.command;
      }
      if (args.docker.commandArgs) {
        container.args = args.docker.commandArgs;
      }
      if (args.docker.workingDir) {
        container.workingDir = args.docker.workingDir;
      }
    }

    // if a serviceAccountName was specified, use it. Otherwise use the default serviceAccount
    const serviceAccountName =
      args.podSpec && args.podSpec.serviceAccountName ? args.podSpec.serviceAccountName : 'default';
    this.deployment = new k8s.apps.v1.Deployment(
      name,
      {
        metadata: {
          name,
          namespace,
          labels,
          annotations
        },
        spec: {
          minReadySeconds: args.minReadySeconds != null ? args.minReadySeconds : 30,
          selector: { matchLabels: labels },
          replicas: defaultTo(args.replicas, 1),
          template: {
            metadata: { labels, namespace },
            spec: {
              affinity: args.podSpec && args.podSpec.affinity,
              containers: [container],
              serviceAccountName: serviceAccountName,
              volumes: args.mountClusterInternalCaCert
                ? [
                    {
                      name: CLUSTER_INTERNAL_CA_CERTIFICATE_SECRET_NAME,
                      secret: {
                        secretName: CLUSTER_INTERNAL_CA_CERTIFICATE_SECRET_NAME
                      }
                    }
                  ]
                : []
            }
          }
        }
      },
      { parent: this }
    );

    if (args.podDisruptionBudget) {
      new k8s.policy.v1beta1.PodDisruptionBudget(
        name,
        {
          metadata: {
            name,
            namespace,
            labels: {
              app: name
            }
          },
          spec: {
            minAvailable: '50%',
            selector: {
              matchLabels: {
                app: name
              }
            }
          }
        },
        {
          parent: this,
          dependsOn: this.deployment
        }
      );
    }

    if (args.service) {
      if (!args.service.expose || args.service.expose === 'ClusterInternal') {
        this.service = new k8s.core.v1.Service(
          name,
          {
            metadata: {
              name,
              namespace,
              labels
            },
            spec: {
              selector: labels,
              ports: [{ name: 'http', port: 80, targetPort: containerPort }],
              type: 'ClusterIP'
            }
          },
          { parent: this, dependsOn: this.deployment }
        );
      } else if (args.service.expose === 'VPCInternal') {
        const externalDnsName = `${name}.${environment}.${internalDomain}`;
        this.url = pulumi.output(`http://${externalDnsName}`);
        this.service = new k8s.core.v1.Service(
          name,
          {
            metadata: {
              name,
              namespace,
              labels,
              annotations: {
                'cloud.google.com/load-balancer-type': 'Internal',
                'external-dns.alpha.kubernetes.io/hostname': externalDnsName
              }
            },
            spec: {
              selector: labels,
              ports: [{ name: 'http', port: 80, targetPort: containerPort }],
              type: 'LoadBalancer'
            }
          },
          { parent: this, dependsOn: this.deployment }
        );
      }

      this.registerOutputs({
        url: this.url
      });
    }
  }
}
