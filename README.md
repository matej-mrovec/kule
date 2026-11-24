# Koulovaná

Jednoduchá online hra pro dva hráče v Pythonu + Flasku. Postavičky se střídají
v hodech koulí, mohou chodit, skákat a krčit se. **Koule podléhá gravitaci**,
takže letí parabolou – rovný hod k zemi nedoletí. První hráč, který nasbírá
5 zásahů, vyhrává.

## Jak to funguje

- Server (`game.py`) je autoritativní: počítá pohyb, skoky, gravitaci, odrazy i zásahy.
- Prohlížeč (`static/game.js`) jen posílá stisknuté klávesy a úhel/sílu hodu
  (`POST /api/update`, cca 14× za sekundu) a vykresluje canvas ze získaných snímků.
- Žádné WebSockety ani Redis – stačí Flask/gunicorn, takže to zvládne i malý pod.
- Místnosti mají 4místný kód; odkaz `?room=KOD` připojí soupeře přímo do ní.
- Stav místností je v paměti jednoho workeru (`--workers 1`). Při škálování na
  více podů/replik by bylo třeba stav přesunout do Redisu nebo zapnout session
  affinity – pro tento účel je deployment nastaven na `replicas: 1`.

## Ovládání

| Akce | Klávesy |
| --- | --- |
| Pohyb | `A`/`D` nebo `←`/`→` |
| Skok | `W`, `↑` nebo `mezerník` |
| Krčení (menší hitbox, pomalejší pohyb) | `S` nebo `↓` |
| Hod | tážení myší z postavičky (čím dál, tím větší síla) nebo `F`/`Enter` |

Před hodem se zobrazí tečkovaná trajektorie – vede ve stejné fyzice jako server.

## Spuštění lokálně

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
# http://localhost:5000
```

Spustit testy fyziky a pravidel:

```bash
python -m unittest discover -s tests -v
```

Nebo přes Docker:

```bash
docker compose up --build
# http://localhost:5000
```

Otevři stránku ve dvou oknech/prohlížečích. První hráč dostane kód místnosti,
druhý se připojí automaticky (nebo přes sdílený odkaz).

## Nasazení na Rancher / Kubernetes

1. Sestav obraz a pushni ho do svého registru:

   ```bash
   docker build -t ghcr.io/<tvuj-login>/koulovana:1.0.0 .
   docker push ghcr.io/<tvuj-login>/koulovana:1.0.0
   ```

2. V `k8s/deployment.yaml` uprav `image:` na svůj obraz a v `k8s/ingress.yaml`
   nastav `host:` na svou doménu (případně nastav Ingress v Rancher UI).

3. Aplikuj manifesty:

   ```bash
   kubectl apply -k k8s
   ```

   Nebo v Rancheru: **Workloads → Import YAML**, respektive vytvoř Deployment,
   Service a Ingress ze souborů ve složce `k8s/`.

4. Ověř Health check: `GET /healthz` vrací `{"status":"ok"}`.

Poznámka: pokud není dostupný nginx ingress controller, odstraň `ingress.yaml`
ze `kustomization.yaml` a vystav hru přes Rancher LoadBalancer / NodePort
(uprav `service.yaml` na `type: LoadBalancer`).

## API

| Metoda | Cesta | Popis |
| --- | --- | --- |
| POST | `/api/join` | Připojení hráče (`name`, volitelně `room`) |
| POST | `/api/update` | Vstupy + snímek světa (`room`, `playerId`, `left`, `right`, `crouch`, `jump`, `throw`, `angle`, `power`) |
| GET | `/api/state` | Jen snímek světa |
| POST | `/api/newgame` | Nový zápas ve stejné místnosti |
| POST | `/api/leave` | Opustit místnost |
| GET | `/healthz` | Health check pro Kubernetes |
