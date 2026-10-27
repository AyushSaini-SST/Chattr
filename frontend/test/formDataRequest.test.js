import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { prepareFormDataRequest } from '../src/services/formDataRequest.js';

test('multipart request keeps the selected image File and clears the inherited JSON header', () => {
  const file = new Blob(['image bytes'], { type: 'image/png' });
  const body = new FormData();
  body.append('image', file, 'avatar.png');
  const config = { data: body, headers: new axios.AxiosHeaders({ 'Content-Type': 'application/json' }) };

  const prepared = prepareFormDataRequest(config);
  assert.equal(prepared.headers.getContentType(), undefined);
  const transformedBody = axios.defaults.transformRequest[0](prepared.data, prepared.headers);
  assert.equal(transformedBody, body);
  assert.equal(transformedBody.get('image').name, 'avatar.png');
  assert.equal(transformedBody.get('image').type, 'image/png');
});

test('ordinary JSON requests retain their configured content type', () => {
  const config = { data: { name: 'Chattr' }, headers: new axios.AxiosHeaders({ 'Content-Type': 'application/json' }) };
  prepareFormDataRequest(config);
  assert.equal(config.headers.getContentType(), 'application/json');
});
