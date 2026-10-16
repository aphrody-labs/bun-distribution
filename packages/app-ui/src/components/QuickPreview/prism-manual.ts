// Disable Prism's automatic highlighting on DOMContentLoaded; read by the core when it evaluates.
const scope = window as unknown as { Prism?: { manual?: boolean } };
scope.Prism = scope.Prism ?? {};
scope.Prism.manual = true;


