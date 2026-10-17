
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const response = http.get(`${BASE_URL}/health`);

  check(response, {
    'health endpoint returns 200': (r) => r.status === 200,
    'gateway reports healthy': (r) => {
      try {
        const body = r.json();
        return body.status === 'ok' && body.service === 'c4-gateway';
      } catch (_) {
        return false;
      }
    },
  });

  sleep(1);
}
