import { core } from '@pulumi/kubernetes/types/input';

/**
 * Exposes a readiness probe config with some sane defaults.
 * Note: once a readyness probe passes k8s will do two things: It will route traffic to the new pods, and it will start terminating the old pods.
 * Generally speaking setting the right parameters here influences the rollout behaviour in case of deployment, i.e. how long a rollout takes and
 * how "sure" k8s has to be before deleting the old pods.
 * @param param0
 */
export function ReadinessProbe({
  initialDelaySeconds,
  path = '/status?fail_loudly=true',
  port = 80
}: {
  /**
   * initial delay seconds is how long to wait until probing. This is highly app specific, but as a guidance probably should be lower
   * than the livenessProbe delay.
   */
  initialDelaySeconds: core.v1.Probe['initialDelaySeconds'];
  /**
   * The http path to send a GET request for health checking. The default path assumes that you use the healthcheck middleware of @acme/util in your nodejs app.
   * For python and java apps this most likely has to be set to something different.
   */
  path?: core.v1.HTTPGetAction['path'];
  /**
   * The port to use for health checking. Defaults to 80. Most likely should be the same as the `internalHttpPort` of your app
   */
  port?: core.v1.HTTPGetAction['port'];
}): core.v1.Probe {
  return {
    initialDelaySeconds,
    periodSeconds: 3,
    failureThreshold: 10,
    // we want 3 consecutive successfull requests before we consider an app ready.
    successThreshold: 3,
    timeoutSeconds: 5,
    httpGet: {
      path,
      port
    }
  };
}

/**
 * Expose a liveness probe with some sane defaults.
 * Note: Once a readyness probe fails, kubernetes will actively restart the container.
 * Since this this a somewhat intrusive thing the defaults only restart the container after 6 consecutive failures with a 10 seconds distance,
 * which means if an app absolutely doesn't work for an entire minute we restart it.
 * @param param0
 */
export function LivenessProbe({
  initialDelaySeconds,
  path = '/status?fail_loudly=true',
  port = 80
}: {
  /**
   * initial delay seconds is how long to wait until probing. This is highly app specific, but as a guidance probably should be higher than the
   * readyness delay. In most cases the a large initial delay for livness probles isn't problematic since crashing your app on bootstrap in combination
   * with readyness probes should make it relatively unlikely for an app to go live / serve traffic in the first place.
   * As such liveness probes are more useful to detect and mitigate long-term failures of apps that have been running a while, rather than bootstrap problems.
   */
  initialDelaySeconds: core.v1.Probe['initialDelaySeconds'];
  /**
   * The http path to send a GET request for health checking. The default path assumes that you use the healthcheck middleware of @acme/util in your nodejs app.
   * For python and java apps this most likely has to be set to something different.
   */
  path?: core.v1.HTTPGetAction['path'];
  port?: core.v1.HTTPGetAction['port'];
}): core.v1.Probe {
  return {
    initialDelaySeconds,
    periodSeconds: 10,
    failureThreshold: 6,
    timeoutSeconds: 5,
    httpGet: {
      path,
      port
    }
  };
}
