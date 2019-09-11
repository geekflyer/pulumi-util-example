import { getCluster } from '@pulumi/gcp/container';
import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { defaultProject, defaultZone } from './gcp-constants';
import { packageConfig, context } from './misc';
import { memoize } from 'lodash';

const gcpConfig = new pulumi.Config('gcp');

// most functions in this module, especially the ones which perform I/O, are memoized. This is to improve lookup speed in bigger pulumi programs like acme-apis AND
// to avoid resource id conflicts in pulumi when importing the same cluster / resource multiple times.

function _getClusterInfoByName(clusterName: string) {
  return getCluster({
    name: clusterName,
    project: gcpConfig.get('project') || defaultProject,
    zone: gcpConfig.get('zone') || defaultZone
  });
}

export const getClusterInfoByName = memoize(_getClusterInfoByName) as typeof _getClusterInfoByName;

function _getClusterInfoFromInferredCluster() {
  return getCluster({
    name: packageConfig.require('cluster'),
    project: gcpConfig.get('project') || defaultProject,
    zone: gcpConfig.get('zone') || defaultZone
  });
}

export const getClusterInfoFromInferredCluster = memoize(
  _getClusterInfoFromInferredCluster
) as typeof _getClusterInfoFromInferredCluster;

export const getK8sProviderByClusterName: (clusterName: string) => k8s.Provider = memoize((clusterName: string) => {
  if (clusterName === 'minikube') {
    console.log('Using "minikube" K8s provider using contents of $KUBECONFIG environment variable.');
    return new k8s.Provider('minikube', { context: 'minikube' });
  }
  return new k8s.Provider(clusterName, {
    namespace: context.inferredNamespace,
    kubeconfig: getClusterInfoByName(clusterName).then(({ endpoint, masterAuths }) =>
      createKubectlConfig({ endpoint, clusterCaCertificate: masterAuths[0].clusterCaCertificate })
    )
  });
});

export const getK8sProviderFromInferredCluster = memoize(() =>
  getK8sProviderByClusterName(packageConfig.require('cluster'))
);

export function createKubectlConfig({
  endpoint,
  clusterCaCertificate
}: {
  endpoint: string;
  clusterCaCertificate: string;
}) {
  const context = `dynamic-context`;
  return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    auth-provider:
      config:
        cmd-args: config config-helper --format=json
        cmd-path: gcloud
        expiry-key: '{.credential.token_expiry}'
        token-key: '{.credential.access_token}'
      name: gcp
`;
}
