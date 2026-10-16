import { AchilleaLiveHub, type AchilleaLiveHubProps } from "./AchilleaLiveHub";

export type AchilleaBannerProps = AchilleaLiveHubProps;

export function AchilleaBanner(props: AchilleaBannerProps) {
  return <AchilleaLiveHub {...props} />;
}

export { AchilleaLiveHub };
