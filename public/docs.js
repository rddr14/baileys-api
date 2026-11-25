function getBaseUrl() {
    var u = document.getElementById('baseUrlInput').value.trim();
    if (u.endsWith('/')) u = u.slice(0, -1);
    return u || window.location.origin;
}

function getInstance() {
    return document.getElementById('instanceInput').value.trim() || 'minha_instancia';
}

function switchSnippetTab(btn, targetId) {
    var parent = btn.closest('.code-box');
    parent.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
    parent.querySelectorAll('.tab-content').forEach(function(c) { c.style.display = 'none'; });
    btn.classList.add('active');
    document.getElementById(targetId).style.display = 'block';
}

function copyCardSnippet(epId) {
    var activeCode = document.querySelector('#' + epId + ' .tab-content:not([style*="display: none"]) code');
    if (activeCode) {
        navigator.clipboard.writeText(activeCode.innerText).then(function() {
            alert('Código copiado com sucesso!');
        });
    }
}

function filterEndpoints() {
    var q = document.getElementById('searchInput').value.toLowerCase().trim();
    var cards = document.querySelectorAll('.endpoint-card');
    var links = document.querySelectorAll('.nav-link');
    var categories = document.querySelectorAll('.nav-category');

    cards.forEach(function(c) {
        var searchData = c.getAttribute('data-search') || '';
        c.style.display = (!q || searchData.includes(q)) ? 'block' : 'none';
    });

    links.forEach(function(l) {
        var searchData = l.getAttribute('data-search') || '';
        l.style.display = (!q || searchData.includes(q)) ? 'flex' : 'none';
    });

    categories.forEach(function(cat) {
        var visibleLinks = cat.querySelectorAll('.nav-link:not([style*="display: none"])');
        cat.style.display = visibleLinks.length > 0 ? 'block' : 'none';
    });
}

function updateAllDynamicCode() {
    var base = getBaseUrl();
    var inst = getInstance();

    document.querySelectorAll('.inst-var').forEach(function(el) {
        el.innerText = inst;
    });

    document.querySelectorAll('.endpoint-card').forEach(function(card) {
        var epPath = card.getAttribute('data-path');
        var epMethod = card.getAttribute('data-method');
        var bodyStr = card.getAttribute('data-body');
        var parsedBody = null;
        try { if (bodyStr) parsedBody = JSON.parse(bodyStr); } catch(_) {}

        var finalPath = epPath.replace('{instance}', inst).replace('{sessionId}', inst).replace('{phone}', '5561991748140').replace('{labelId}', '10');

        // Atualiza cURL
        var curl = 'curl -X ' + epMethod + ' "' + base + finalPath + '"';
        curl += ' \\\n  -H "Content-Type: application/json"';
        if (parsedBody && (epMethod === 'POST' || epMethod === 'PUT')) {
            curl += " \\\n  -d '" + JSON.stringify(parsedBody, null, 2) + "'";
        }
        var curlEl = card.querySelector('.code-curl');
        if (curlEl) curlEl.innerText = curl;

        // Atualiza PHP
        var php = '$response = Http::withHeaders([\n    "Content-Type" => "application/json",\n])->' + epMethod.toLowerCase() + '("' + base + finalPath + '"';
        if (parsedBody && (epMethod === 'POST' || epMethod === 'PUT')) {
            php += ', [\n';
            for (var k in parsedBody) {
                php += '    "' + k + '" => ' + JSON.stringify(parsedBody[k]) + ',\n';
            }
            php += ']';
        }
        php += ');\n\n$data = $response->json();';
        var phpEl = card.querySelector('.code-php');
        if (phpEl) phpEl.innerText = php;

        // Atualiza JS
        var js = 'const response = await fetch("' + base + finalPath + '", {\n  method: "' + epMethod + '",\n  headers: { "Content-Type": "application/json" },\n';
        if (parsedBody && (epMethod === 'POST' || epMethod === 'PUT')) {
            js += '  body: JSON.stringify(' + JSON.stringify(parsedBody, null, 4).replace(/\n/g, '\n  ') + ')\n';
        }
        js += '});\nconst result = await response.json();';
        var jsEl = card.querySelector('.code-js');
        if (jsEl) jsEl.innerText = js;
    });
}

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    if (window.location.origin && window.location.origin.startsWith('http')) {
        document.getElementById('baseUrlInput').value = window.location.origin;
        updateAllDynamicCode();
    }
});
