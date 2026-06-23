.PHONY: dev frontend backend stop restart install-cli

FRONTEND_PORT ?= 3000
BACKEND_PORT ?= 8000

stop:
	-lsof -ti:$(FRONTEND_PORT) | xargs kill -9 2>/dev/null || true
	-lsof -ti:$(BACKEND_PORT) | xargs kill -9 2>/dev/null || true

frontend:
	npm run dev

backend:
	. .venv/bin/activate && uvicorn app.main:app --app-dir src/backend --reload --port $(BACKEND_PORT)

dev:
	$(MAKE) stop
	$(MAKE) -j2 frontend backend

restart:
	$(MAKE) dev

install-cli:
	bash install.sh
