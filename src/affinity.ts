import { core } from '@pulumi/kubernetes/types/input';

export const preferPreemptibleAffinity: core.v1.Affinity = {
  nodeAffinity: {
    preferredDuringSchedulingIgnoredDuringExecution: [
      {
        weight: 1,
        preference: {
          matchExpressions: [
            {
              key: 'cloud.google.com/gke-preemptible',
              operator: 'In',
              values: ['true']
            }
          ]
        }
      }
    ]
  }
};
