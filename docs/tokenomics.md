# Halom Tokenomika

## Áttekintés

A Halom (HOM) egy innovatív inflációkövető kriptovaluta, amely ötvözi a fix maximális kínálatot a dinamikus kibocsátással. A rendszer 100 millió HOM maximális kínálattal rendelkezik, és a kibocsátás az inflációs rátához igazodik.

## Tokenomikai Paraméterek

| Paraméter | Érték | Leírás |
|-----------|--------|---------|
| Maximális Kínálat | 100,000,000 HOM | A valaha kibocsátható tokenek maximális mennyisége |
| Kezdeti Kínálat | 10,000,000 HOM | A genesis blokkban létrehozott tokenek mennyisége |
| Alap Blokkjutalom | 50 HOM | Az alapvető jutalom blokkonként |
| Blokk Időköz | ~6 másodperc | Átlagos blokkgenerálási idő |
| Éves Blokkok | 2,628,000 | Várható blokkok száma évente |

## Jutalmazási Rendszer

### Bányászati Jutalmak

1. **Alap Jutalom**: 50 HOM/blokk
2. **Inflációs Korrekció**: Az alap jutalom szorzódik az aktuális inflációs rátával
3. **Licenc Bónusz**:
   - Standard: +20% (5,000 HOM)
   - Premium: +35% (25,000 HOM)
   - Enterprise: +50% (100,000 HOM)
4. **Staking Bónusz**: +10% minimum 10,000 HOM stake esetén

### Példa Számítás

```python
alap_jutalom = 50 HOM
inflációs_ráta = 5%  # példa érték
licenc_bónusz = 20%  # Standard licenc
staking_bónusz = 10%

végső_jutalom = alap_jutalom * (1 + inflációs_ráta) * (1 + licenc_bónusz) * (1 + staking_bónusz)
# 50 * 1.05 * 1.2 * 1.1 = 69.3 HOM
```

## Licenc Rendszer

### Licenc Típusok és Árak

| Típus | Bónusz | Ár (HOM) | Minimum Időtartam |
|-------|---------|-----------|-------------------|
| Standard | 20% | 5,000 | 1 év |
| Premium | 35% | 25,000 | 1 év |
| Enterprise | 50% | 100,000 | 1 év |

### Licenc Díjak Felosztása
- 85% Token Lock (Treasury)
- 15% Aktív Treasury

## Staking Rendszer

### Staking Paraméterek

| Paraméter | Érték | Leírás |
|-----------|--------|---------|
| Minimum Stake | 10,000 HOM | Minimum letét a bónuszhoz |
| Staking Bónusz | 10% | Extra jutalom a blokkjutalomra |
| Zárolási Idő | Nincs minimum | Rugalmas zárolás |

## Treasury Rendszer

### Treasury Bevételek
1. Licenc díjak 15%-a
2. Tranzakciós díjak egy része
3. Egyéb rendszerszintű díjak

### Treasury Felhasználás
- Fejlesztés finanszírozása
- Marketing és növekedés
- Közösségi projektek
- Biztonsági audit és bounty programok

## Inflációs Modell

### Kibocsátási Ütemterv
1. **Kezdeti Fázis** (0-20M HOM):
   - Magasabb alap jutalmak
   - Teljes inflációs korrekció

2. **Növekedési Fázis** (20M-50M HOM):
   - Mérsékelt alap jutalmak
   - Részleges inflációs korrekció

3. **Érett Fázis** (50M-100M HOM):
   - Csökkentett alap jutalmak
   - Minimális inflációs korrekció

### Inflációs Védelem
1. **Dinamikus Kibocsátás**:
   - A blokkjutalmak az inflációhoz igazodnak
   - Havi frissítés az oracle adatok alapján

2. **Supply Cap Védelem**:
   - 100M HOM maximális kínálat
   - Automatikus jutalom csökkentés a cap közelében

## Gazdasági Ösztönzők

### Hosszú Távú Résztvevők
1. **Licenc Rendszer**:
   - Jelentős bónuszok (20-50%)
   - 1 éves minimum időtartam
   - Magas kezdeti befektetés

2. **Staking Rendszer**:
   - Extra 10% jutalom
   - Rugalmas zárolás
   - Alacsonyabb belépési küszöb

### Hálózatbiztonság
1. **Bányászati Ösztönzők**:
   - Garantált alap jutalom
   - Inflációkövető korrekció
   - Többszintű bónusz rendszer

2. **Gazdasági Védelem**:
   - Magas licenc díjak
   - Treasury tartalékok
   - Rugalmas paraméterezés

## Jövőbeli Fejlesztések

1. **Governance Rendszer**:
   - Token holder szavazás
   - Paraméter módosítások
   - Treasury felhasználás

2. **DeFi Integráció**:
   - Likviditás bányászat
   - Yield farming
   - Kölcsönzési lehetőségek

3. **Technikai Fejlesztések**:
   - Layer 2 skálázás
   - Cross-chain hidak
   - Smart contract platform 