// picomatch ships without types; this is the one call shape the build-tracing test uses.
declare module "picomatch" {
  export default function picomatch(glob: string | string[], options?: Record<string, unknown>): (input: string) => boolean;
}
