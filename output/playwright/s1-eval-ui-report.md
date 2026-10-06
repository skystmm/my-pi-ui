# System One evaluation e446ced1-fc55-4417-abb8-49ca08292be6

Status: completed · suite: smoke-v1

Smoke tests verify integration only; they do not establish model quality or token savings.

Completed: 12/12; errors: 0; unsupported: 0.

| Model | Type | Group | Valid/attempted | Accuracy | Attempted accuracy | Brier | ECE | MAE | p50/p95 ms |
|---|---|---|---|---|---|---|---|---|---|
| laya-en | choice | all | 2/2 | 1.0000 | 1.0000 | 0.0439 | 0.1351 | N/A | 30.3482/264.1813 |
| laya-en | choice | language:en | 1/1 | 1.0000 | 1.0000 | 0.0769 | 0.1961 | N/A | 264.1813/264.1813 |
| laya-en | choice | language:zh | 1/1 | 1.0000 | 1.0000 | 0.0110 | 0.0741 | N/A | 30.3482/30.3482 |
| laya-en | choice | tag:intent | 2/2 | 1.0000 | 1.0000 | 0.0439 | 0.1351 | N/A | 30.3482/264.1813 |
| laya-en | noul | all | 2/2 | 1.0000 | 1.0000 | 0.0039 | 0.0620 | N/A | 30.5682/43.9126 |
| laya-en | noul | language:en | 1/1 | 1.0000 | 1.0000 | 0.0042 | 0.0645 | N/A | 30.5682/30.5682 |
| laya-en | noul | language:zh | 1/1 | 1.0000 | 1.0000 | 0.0035 | 0.0595 | N/A | 43.9126/43.9126 |
| laya-en | noul | tag:context | 2/2 | 1.0000 | 1.0000 | 0.0039 | 0.0620 | N/A | 30.5682/43.9126 |
| laya-en | score | all | 2/2 | N/A | N/A | N/A | N/A | 0.4765 | 27.4738/33.2370 |
| laya-en | score | language:en | 1/1 | N/A | N/A | N/A | N/A | 0.2023 | 27.4738/27.4738 |
| laya-en | score | language:zh | 1/1 | N/A | N/A | N/A | N/A | 0.7508 | 33.2370/33.2370 |
| laya-en | score | tag:relevance | 2/2 | N/A | N/A | N/A | N/A | 0.4765 | 27.4738/33.2370 |
| laya-multi | choice | all | 2/2 | 0.5000 | 0.5000 | 0.4558 | 0.0639 | N/A | 20.3071/96.7076 |
| laya-multi | choice | language:en | 1/1 | 1.0000 | 1.0000 | 0.3349 | 0.4092 | N/A | 96.7076/96.7076 |
| laya-multi | choice | language:zh | 1/1 | 0.0000 | 0.0000 | 0.5767 | 0.5370 | N/A | 20.3071/20.3071 |
| laya-multi | choice | tag:intent | 2/2 | 0.5000 | 0.5000 | 0.4558 | 0.0639 | N/A | 20.3071/96.7076 |
| laya-multi | noul | all | 2/2 | 1.0000 | 1.0000 | 0.0253 | 0.1187 | N/A | 20.4429/21.4808 |
| laya-multi | noul | language:en | 1/1 | 1.0000 | 1.0000 | 0.0002 | 0.0130 | N/A | 20.4429/20.4429 |
| laya-multi | noul | language:zh | 1/1 | 1.0000 | 1.0000 | 0.0504 | 0.2244 | N/A | 21.4808/21.4808 |
| laya-multi | noul | tag:context | 2/2 | 1.0000 | 1.0000 | 0.0253 | 0.1187 | N/A | 20.4429/21.4808 |
| laya-multi | score | all | 2/2 | N/A | N/A | N/A | N/A | 0.5485 | 19.8983/21.6435 |
| laya-multi | score | language:en | 1/1 | N/A | N/A | N/A | N/A | 0.2844 | 21.6435/21.6435 |
| laya-multi | score | language:zh | 1/1 | N/A | N/A | N/A | N/A | 0.8127 | 19.8983/19.8983 |
| laya-multi | score | tag:relevance | 2/2 | N/A | N/A | N/A | N/A | 0.5485 | 19.8983/21.6435 |

Metrics: s1-metrics-v1; suite SHA256: 49cf75d0c6a9156d9f5b034df7a4111058a77d924aadacba736e202beab4d5e7.

Workflow token savings: not_run. Confidence uses probabilities, not vendor confidence. No retries.
