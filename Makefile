.PHONY: up down seed migrate expire-demo test integration stress web-check e2e
up:
	docker compose up --build -d --wait
down:
	docker compose down
seed:
	docker compose exec api /app/manage seed
migrate:
	docker compose exec api /app/manage migrate
expire-demo:
	docker compose exec api /app/manage expire-demo
test:
	go test ./internal/allocation ./internal/domain
integration:
	go test -race -count=1 -v ./tests/integration ./tests/concurrency
stress:
	go test -race -count=10 -run Test100ConcurrentHTTPClaims -v ./tests/concurrency
web-check:
	cd apps/web && npm run lint && npm run typecheck && npm test && npm run build
e2e:
	cd apps/web && npm run test:e2e
