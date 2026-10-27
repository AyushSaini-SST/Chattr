export function errorHandler(error, _req, res, _next) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: { message: status >= 500 ? 'Something went wrong. Please try again.' : error.message },
  });
}
