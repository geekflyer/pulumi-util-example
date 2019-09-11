import { Config, Input } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { context } from './misc';

export interface IapComponents {
  service: k8s.core.v1.Service;
  ingress: k8s.extensions.v1beta1.Ingress;
}

/**
 * This follows the guide on https://cloud.google.com/iap/docs/enabling-kubernetes-howto
 * to create an IAP enabled Service and Ingress.
 * You have to provide OAuth credentials as pulumi config with the config keys:
 * `iap:client_id` and `iap:client_secret`.
 */
export function createIapEnabledServiceAndIngress({
  name,
  externalDnsName,
  k8sProvider,
  namespace = context.inferredNamespace,
  port = 80,
  timeout = 120
}: {
  name: string;
  externalDnsName: Input<string>;
  k8sProvider: k8s.Provider;
  namespace?: Input<string>;
  port?: Input<number>;
  timeout?: Input<number>;
}): IapComponents {
  const iapCredentials = new Config('iap');

  const acmeIAPOauthSecret = new k8s.core.v1.Secret(
    name + '-iap-oauth-secret',
    {
      metadata: {
        namespace
      },
      stringData: {
        client_id: iapCredentials.require('client_id'),
        client_secret: iapCredentials.require('client_secret')
      }
    },
    {
      provider: k8sProvider
    }
  );

  const gcpBackendConfig = new k8s.apiextensions.CustomResource(
    name,
    {
      apiVersion: 'cloud.google.com/v1beta1',
      kind: 'BackendConfig',
      metadata: {
        name: name + '-backend-config',
        namespace
      },
      spec: {
        iap: {
          enabled: true,
          oauthclientCredentials: {
            secretName: acmeIAPOauthSecret.metadata.name
          }
        },
        timeoutSec: timeout
      }
    },
    {
      provider: k8sProvider
    }
  );

  const service = new k8s.core.v1.Service(
    name,
    {
      metadata: {
        name,
        namespace,
        labels: {
          app: name
        },
        annotations: {
          'beta.cloud.google.com/backend-config': gcpBackendConfig.metadata.name.apply(backendConfigName =>
            JSON.stringify({ default: backendConfigName })
          )
        }
      },
      spec: {
        selector: {
          app: name
        },
        ports: [{ name: 'http', port }],
        type: 'NodePort'
      }
    },
    {
      provider: k8sProvider
    }
  );

  const ingress = new k8s.extensions.v1beta1.Ingress(
    name,
    {
      metadata: {
        name,
        namespace,
        annotations: {
          'certmanager.k8s.io/cluster-issuer': 'letsencrypt-prod',
          'certmanager.k8s.io/acme-challenge-type': 'dns01',
          'certmanager.k8s.io/acme-dns01-provider': 'clouddns',
          'external-dns.alpha.kubernetes.io/hostname': externalDnsName
        }
      },
      spec: {
        tls: [
          {
            secretName: `${name}-crt`,
            hosts: [externalDnsName]
          }
        ],
        backend: {
          serviceName: service.metadata.name,
          servicePort: port
        }
      }
    },
    {
      provider: k8sProvider
    }
  );

  return {
    service,
    ingress
  };
}
