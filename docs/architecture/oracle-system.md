# Oracle Rendszer Architektúra

## Áttekintés

A Halom Oracle rendszer egy decentralizált adatforrás-hálózat, amely megbízható inflációs adatokat szolgáltat a blockchain számára. A rendszer több független node-ból áll, amelyek különböző forrásokból gyűjtik az adatokat és konszenzus alapján határozzák meg a végső értéket.

## Komponensek

### Oracle Node-ok

- **Funkcionalitás**: Minden node független adatgyűjtést végez különböző forrásokból
- **Validáció**: A node-ok ellenőrzik az adatok érvényességét és konzisztenciáját
- **Reputáció**: A node-ok reputációs pontszámmal rendelkeznek, amely befolyásolja a szavazatuk súlyát

### Konszenzus Mechanizmus

- **Súlyozott Szavazás**: A node-ok reputációjuk alapján súlyozott szavazatokkal rendelkeznek
- **Validációs Szabályok**:
  - Minimum node szám: 3
  - Maximum eltérés threshold: 10%
  - Kötelező források jelenléte

### Adatforrások

- **Elsődleges Források**:
  - Központi bankok API-jai
  - Statisztikai hivatalok
  - Pénzügyi szolgáltatók
- **Másodlagos Források**:
  - Közgazdasági elemzők
  - Piaci indikátorok

## Biztonsági Mechanizmusok

### Adat Validáció

```python
def érték_validálás(érték: float, előzmények: List[float]) -> bool:
    if not előzmények:
        return True
        
    átlag = statistics.mean(előzmények)
    eltérés = abs(érték - átlag) / átlag * 100
    
    return eltérés <= MAX_ELTÉRÉS_SZÁZALÉK
```

### Reputáció Kezelés

```python
def reputáció_frissítés(node: Node, siker: bool):
    if siker:
        node.reputation = min(node.reputation + 1, 100)
    else:
        node.reputation = max(node.reputation - 5, 0)
```

## Teljesítmény és Skálázhatóság

### Metrikák

- **Válaszidő**: < 1 másodperc átlagosan
- **Throughput**: > 100 kérés/másodperc
- **Rendelkezésre állás**: 99.9%

### Monitoring

- Prometheus metrikák:
  - `oracle_keres_ido_masodperc`
  - `oracle_konszenzus_ido_masodperc`
  - `oracle_aktiv_node_szam`
  - `oracle_sikeres_frissitesek_total`

## Hibakezelés

### Visszaállási Stratégiák

1. **Node Kiesés**:
   - Automatikus újracsatlakozás
   - Tartalék node-ok aktiválása
   
2. **Adatforrás Hiba**:
   - Fallback források használata
   - Cache-elt értékek felhasználása

3. **Konszenzus Hiba**:
   - Újrapróbálkozás növekvő időközökkel
   - Manuális beavatkozás trigger

## Fejlesztési Útmutató

### Új Node Hozzáadása

1. Konfiguráció létrehozása:
```python
node_config = OracleNodeConfig(
    node_id="új_node_1",
    min_válaszidő_ms=1000,
    max_eltérés_százalék=5.0
)
```

2. Node inicializálása:
```python
async def initialize_node():
    await node.connect()
    await node.sync_state()
    await node.start_monitoring()
```

### Új Adatforrás Integrálása

1. Forrás implementálása:
```python
class ÚjForrás(DataSource):
    async def fetch_data(self) -> float:
        # Implementáció
        pass
        
    async def validate_data(self, érték: float) -> bool:
        # Validáció
        pass
```

## Konfigurációs Paraméterek

| Paraméter | Alapérték | Leírás |
|-----------|-----------|---------|
| MIN_NODE_SZÁM | 3 | Minimum aktív node-ok száma |
| MAX_ELTÉRÉS_SZÁZALÉK | 10.0 | Maximum megengedett eltérés |
| FRISSÍTÉSI_INTERVALLUM | 300 | Frissítések közötti idő (mp) |
| REPUTÁCIÓ_NÖVEKMÉNY | 1 | Sikeres frissítés reputáció növekménye |
| REPUTÁCIÓ_CSÖKKENÉS | 5 | Sikertelen frissítés reputáció csökkenése |

## Ismert Korlátok

1. **Skálázhatóság**:
   - Maximum 100 node támogatott
   - Frissítési gyakoriság minimum 5 perc

2. **Konzisztencia**:
   - CAP theorem szerint AP rendszer
   - Eventual consistency garantált

3. **Biztonsági Korlátok**:
   - 51% támadás elleni védelem nem teljes
   - Sybil támadás részleges védelme

## Jövőbeli Fejlesztések

1. **Technikai Fejlesztések**:
   - Automatikus node skálázás
   - Gépi tanulás alapú anomália detektálás
   - P2P node kommunikáció

2. **Biztonsági Fejlesztések**:
   - Zero-knowledge proof integráció
   - Többszintű validáció
   - Automatikus biztonsági audit

3. **Teljesítmény Optimalizálás**:
   - Párhuzamos adatfeldolgozás
   - Adaptív batch méret
   - Intelligens cache stratégia 