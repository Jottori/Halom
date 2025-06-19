from prometheus_client import Counter, Gauge, Histogram, start_http_server
import logging
from typing import Dict, List
import time
from datetime import datetime

logger = logging.getLogger(__name__)

class OracleMetrics:
    def __init__(self, port: int = 8000):
        self.port = port
        
        # Source metrics
        self.source_value = Gauge(
            'oracle_source_value',
            'Latest value from each data source',
            ['source']
        )
        
        self.source_success = Counter(
            'oracle_source_success_total',
            'Number of successful fetches from each source',
            ['source']
        )
        
        self.source_error = Counter(
            'oracle_source_error_total',
            'Number of failed fetches from each source',
            ['source']
        )
        
        self.source_latency = Histogram(
            'oracle_source_latency_seconds',
            'Time taken to fetch data from each source',
            ['source'],
            buckets=[0.1, 0.5, 1.0, 2.0, 5.0]
        )
        
        # Consensus metrics
        self.consensus_value = Gauge(
            'oracle_consensus_value',
            'Latest consensus value'
        )
        
        self.source_count = Gauge(
            'oracle_source_count',
            'Number of sources used in latest consensus'
        )
        
        self.consensus_error = Counter(
            'oracle_consensus_error_total',
            'Number of consensus calculation errors',
            ['reason']
        )
        
        # Validation metrics
        self.validation_error = Counter(
            'oracle_validation_error_total',
            'Number of validation errors',
            ['reason']
        )
        
        # Submission metrics
        self.submission_success = Counter(
            'oracle_submission_success_total',
            'Number of successful blockchain submissions'
        )
        
        self.submission_error = Counter(
            'oracle_submission_error_total',
            'Number of failed blockchain submissions',
            ['reason']
        )
        
        # Governance metrics
        self.governance_approval = Counter(
            'oracle_governance_approval_total',
            'Number of governance approvals'
        )
        
        self.governance_rejection = Counter(
            'oracle_governance_rejection_total',
            'Number of governance rejections'
        )
        
        # Prometheus metrikák
        self.kérés_idő = Histogram(
            'oracle_keres_ido_masodperc',
            'Oracle kérés feldolgozási ideje',
            buckets=[0.1, 0.5, 1.0, 2.0, 5.0]
        )
        
        self.konszenzus_idő = Histogram(
            'oracle_konszenzus_ido_masodperc',
            'Konszenzus elérési idő',
            buckets=[0.1, 0.5, 1.0, 2.0, 5.0]
        )
        
        self.aktív_node_szám = Gauge(
            'oracle_aktiv_node_szam',
            'Aktív oracle node-ok száma'
        )
        
        self.sikeres_frissítések = Counter(
            'oracle_sikeres_frissitesek_total',
            'Sikeres oracle frissítések száma'
        )
        
        self.hibás_frissítések = Counter(
            'oracle_hibas_frissitesek_total',
            'Hibás oracle frissítések száma'
        )
        
        # Belső metrikák
        self.kérés_idők: List[float] = []
        self.konszenzus_idők: List[float] = []
        self.utolsó_frissítés: Dict[str, datetime] = {}
        
    def initialize(self):
        """Start the metrics server."""
        try:
            start_http_server(self.port)
            logger.info(f"Started metrics server on port {self.port}")
        except Exception as e:
            logger.error(f"Failed to start metrics server: {str(e)}")
            
    def record_source_value(self, source: str, value: float):
        """Record the latest value from a source."""
        self.source_value.labels(source=source).set(value)
        
    def record_source_success(self, source: str):
        """Record a successful fetch from a source."""
        self.source_success.labels(source=source).inc()
        
    def record_source_error(self, source: str):
        """Record a failed fetch from a source."""
        self.source_error.labels(source=source).inc()
        
    def record_source_latency(self, source: str, latency: float):
        """Record the latency of a source fetch."""
        self.source_latency.labels(source=source).observe(latency)
        
    def record_consensus_value(self, value: float):
        """Record the latest consensus value."""
        self.consensus_value.set(value)
        
    def record_source_count(self, count: int):
        """Record the number of sources used in consensus."""
        self.source_count.set(count)
        
    def record_error(self, reason: str):
        """Record an error with the given reason."""
        if reason in ['consensus_failed', 'insufficient_sources']:
            self.consensus_error.labels(reason=reason).inc()
        elif reason in ['validation_failed', 'invalid_range', 'excessive_change']:
            self.validation_error.labels(reason=reason).inc()
        elif reason in ['submission_failed', 'blockchain_error']:
            self.submission_error.labels(reason=reason).inc()
        else:
            logger.warning(f"Unknown error reason: {reason}")
            
    def record_submission_success(self):
        """Record a successful blockchain submission."""
        self.submission_success.inc()
        
    def record_governance_approval(self):
        """Record a governance approval."""
        self.governance_approval.inc()
        
    def record_governance_rejection(self):
        """Record a governance rejection."""
        self.governance_rejection.inc()
        
    def kérés_idő_mérés(self, idő: float):
        """Kérés feldolgozási idő rögzítése"""
        self.kérés_idő.observe(idő)
        self.kérés_idők.append(idő)
        
        # Csak az utolsó 1000 mérést tartjuk meg
        if len(self.kérés_idők) > 1000:
            self.kérés_idők = self.kérés_idők[-1000:]
            
    def konszenzus_idő_mérés(self, idő: float):
        """Konszenzus elérési idő rögzítése"""
        self.konszenzus_idő.observe(idő)
        self.konszenzus_idők.append(idő)
        
        if len(self.konszenzus_idők) > 1000:
            self.konszenzus_idők = self.konszenzus_idők[-1000:]
            
    def node_aktivitás_frissítés(self, node_id: str):
        """Node aktivitás frissítése"""
        most = datetime.now()
        self.utolsó_frissítés[node_id] = most
        
        # Töröljük a régi (10 percnél régebbi) bejegyzéseket
        aktív_node_szám = sum(
            1 for utolsó in self.utolsó_frissítés.values()
            if (most - utolsó).total_seconds() < 600
        )
        self.aktív_node_szám.set(aktív_node_szám)
        
    def sikeres_frissítés_rögzítés(self):
        """Sikeres frissítés rögzítése"""
        self.sikeres_frissítések.inc()
        
    def hiba_rögzítés(self):
        """Hiba rögzítése"""
        self.hibás_frissítések.inc()
        
    def átlagos_kérés_idő(self) -> float:
        """Átlagos kérés feldolgozási idő számítása"""
        return sum(self.kérés_idők) / len(self.kérés_idők) if self.kérés_idők else 0.0
        
    def átlagos_konszenzus_idő(self) -> float:
        """Átlagos konszenzus elérési idő számítása"""
        return sum(self.konszenzus_idők) / len(self.konszenzus_idők) if self.konszenzus_idők else 0.0
        
class TeljesítményMérő:
    """Kontextus menedzser teljesítmény méréshez"""
    
    def __init__(self, metrikák: OracleMetrics, típus: str):
        self.metrikák = metrikák
        self.típus = típus
        self.kezdés: float = 0.0
        
    def __enter__(self):
        self.kezdés = time.time()
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        vége = time.time()
        eltelt_idő = vége - self.kezdés
        
        if self.típus == "kérés":
            self.metrikák.kérés_idő_mérés(eltelt_idő)
        elif self.típus == "konszenzus":
            self.metrikák.konszenzus_idő_mérés(eltelt_idő) 