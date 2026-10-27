export function prepareFormDataRequest(config) {
  if (typeof FormData === 'undefined' || !(config.data instanceof FormData)) return config;

  // Remove the shared JSON default so Axios passes FormData through unchanged.
  // The browser then supplies multipart/form-data with its generated boundary.
  if (typeof config.headers?.delete === 'function') config.headers.delete('Content-Type');
  else if (config.headers) {
    for (const key of Object.keys(config.headers)) {
      if (key.toLowerCase() === 'content-type') delete config.headers[key];
    }
  }
  return config;
}
