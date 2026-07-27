export const isAppStoreBuild = import.meta.env.VITE_BUILD_VARIANT === 'appstore';
export const isReleaseBuild  = import.meta.env.VITE_BUILD_TYPE === 'release';
