import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/db/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATASET = path.resolve(__dirname, '../fixtures/golden-hotspots.json');

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function parseFlags(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadDataset(filePath = DEFAULT_DATASET) {
  const content = await fs.readFile(filePath, 'utf8');
  const rows = JSON.parse(content);
  if (!Array.isArray(rows)) {
    throw new Error('Golden dataset must be a JSON array');
  }
  return rows;
}

async function findEvent(sample) {
  const url = normalize(sample.url);
  const title = normalize(sample.title);
  if (url) {
    const source = await prisma.hotspotSourceItem.findFirst({
      where: {
        OR: [
          { originalUrl: { contains: sample.url } },
          { canonicalUrl: { contains: sample.url } }
        ]
      },
      include: {
        event: {
          include: {
            sourceItems: true
          }
        }
      }
    });
    if (source?.event) return source.event;
  }

  if (title) {
    return prisma.hotspotEvent.findFirst({
      where: {
        title: {
          contains: sample.title
        }
      },
      include: {
        sourceItems: true
      }
    });
  }

  return null;
}

function expectedTrusted(sample) {
  return normalize(sample.expectedStatus) === 'trusted';
}

function predictedTrusted(event) {
  return normalize(event?.verificationStatus) === 'trusted';
}

function bodyMissing(event) {
  return event?.sourceItems?.some((source) => parseFlags(source.evidenceFlagsJson).includes('body_unavailable')) || false;
}

async function main() {
  const datasetPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : DEFAULT_DATASET;
  const samples = await loadDataset(datasetPath);
  const results = [];

  for (const sample of samples) {
    const event = await findEvent(sample);
    results.push({ sample, event });
  }

  const matched = results.filter((item) => item.event);
  const truePositive = matched.filter((item) => expectedTrusted(item.sample) && predictedTrusted(item.event)).length;
  const falsePositive = matched.filter((item) => !expectedTrusted(item.sample) && predictedTrusted(item.event)).length;
  const falseNegative = matched.filter((item) => expectedTrusted(item.sample) && !predictedTrusted(item.event)).length;
  const predictedTrustedCount = matched.filter((item) => predictedTrusted(item.event)).length;
  const expectedTrustedCount = results.filter((item) => expectedTrusted(item.sample)).length;
  const precision = predictedTrustedCount ? truePositive / predictedTrustedCount : 0;
  const recall = expectedTrustedCount ? truePositive / expectedTrustedCount : 0;
  const falsePositiveRate = matched.length ? falsePositive / matched.length : 0;
  const bodyMissingRate = matched.length ? matched.filter((item) => bodyMissing(item.event)).length / matched.length : 0;

  const report = {
    dataset: datasetPath,
    samples: samples.length,
    matched: matched.length,
    missing: samples.length - matched.length,
    trustedHits: truePositive,
    falsePositive,
    falseNegative,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    falsePositiveRate: Number(falsePositiveRate.toFixed(4)),
    bodyMissingRate: Number(bodyMissingRate.toFixed(4))
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
