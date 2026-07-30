import assert from "node:assert/strict";
import { test } from "node:test";
import { forwardAddr, parseEndpointUrl, validateUrlGroups } from "./tunnels.js";

test("parseEndpointUrl: no url falls back to default", () => {
  assert.deepEqual(parseEndpointUrl(undefined), { kind: "default" });
});

test("parseEndpointUrl: https infers http endpoint with HTTPS scheme", () => {
  assert.deepEqual(parseEndpointUrl("https://app.ngrok.app"), {
    kind: "http",
    hostname: "app.ngrok.app",
    scheme: "HTTPS",
  });
});

test("parseEndpointUrl: http infers http endpoint with HTTP scheme", () => {
  assert.deepEqual(parseEndpointUrl("http://app.ngrok.app"), {
    kind: "http",
    hostname: "app.ngrok.app",
    scheme: "HTTP",
  });
});

test("parseEndpointUrl: tls infers tls endpoint", () => {
  assert.deepEqual(parseEndpointUrl("tls://app.ngrok.app"), {
    kind: "tls",
    hostname: "app.ngrok.app",
  });
});

test("parseEndpointUrl: tcp infers tcp endpoint with host:port remoteAddr", () => {
  assert.deepEqual(parseEndpointUrl("tcp://2.tcp.ngrok.io:21746"), {
    kind: "tcp",
    remoteAddr: "2.tcp.ngrok.io:21746",
  });
});

test("parseEndpointUrl: missing scheme throws", () => {
  assert.throws(() => parseEndpointUrl("app.ngrok.app"), /must include a scheme/);
});

test("parseEndpointUrl: unsupported scheme throws", () => {
  assert.throws(() => parseEndpointUrl("ftp://app.ngrok.app"), /unsupported proto/);
});

test("forwardAddr: number becomes a localhost address", () => {
  assert.equal(forwardAddr(3000), "http://localhost:3000");
});

test("forwardAddr: string passed through unchanged", () => {
  assert.equal(forwardAddr("localhost:4000"), "localhost:4000");
});

test("validateUrlGroups: a single endpoint never throws", () => {
  assert.doesNotThrow(() => validateUrlGroups([{ upstream: 3000 }]));
});

test("validateUrlGroups: distinct urls never throw", () => {
  assert.doesNotThrow(() =>
    validateUrlGroups([
      { upstream: 3000, url: "https://a.ngrok.app" },
      { upstream: 4000, url: "https://b.ngrok.app" },
    ]),
  );
});

test("validateUrlGroups: two url-less endpoints with no pooling throws", () => {
  assert.throws(
    () => validateUrlGroups([{ upstream: 3000 }, { upstream: 4000 }]),
    /account's default dev domain/,
  );
});

test("validateUrlGroups: two endpoints sharing an explicit url with no pooling throws", () => {
  assert.throws(
    () =>
      validateUrlGroups([
        { upstream: 3000, url: "https://a.ngrok.app" },
        { upstream: 4000, url: "https://a.ngrok.app" },
      ]),
    /https:\/\/a\.ngrok\.app/,
  );
});

test("validateUrlGroups: pooling on every colliding entry does not throw", () => {
  assert.doesNotThrow(() =>
    validateUrlGroups([
      { upstream: 3000, pooling: true },
      { upstream: 4000, pooling: true },
    ]),
  );
});

test("validateUrlGroups: pooling on only some colliding entries still throws", () => {
  assert.throws(() =>
    validateUrlGroups([
      { upstream: 3000, pooling: true },
      { upstream: 4000 },
    ]),
  );
});
