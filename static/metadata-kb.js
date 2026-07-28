/**
 * static/metadata-kb.js
 * Drives the /metadata-kb page: drag-and-drop, spins up metadata-kb-worker.js
 * to parse the ZIP off the main thread, then renders the summary and wires
 * up the download / copy-to-clipboard actions.
 */

(function () {
    'use strict';

    var dropzoneView = document.getElementById('dropzoneView');
    var dropzone = document.getElementById('dropzone');
    var fileInput = document.getElementById('fileInput');
    var errorBanner = document.getElementById('errorBanner');

    var progressView = document.getElementById('progressView');
    var progressLabel = document.getElementById('progressLabel');
    var progressBar = document.getElementById('progressBar');
    var progressCount = document.getElementById('progressCount');

    var resultsView = document.getElementById('resultsView');
    var resultFileName = document.getElementById('resultFileName');
    var summaryGrid = document.getElementById('summaryGrid');
    var mdPreview = document.getElementById('mdPreview');
    var btnDownload = document.getElementById('btnDownload');
    var btnCopy = document.getElementById('btnCopy');
    var btnStartOver = document.getElementById('btnStartOver');

    var currentMarkdown = '';
    var currentStats = null;

    function showError(message) {
        errorBanner.textContent = message;
        errorBanner.classList.remove('hidden');
    }

    function clearError() {
        errorBanner.classList.add('hidden');
        errorBanner.textContent = '';
    }

    function showView(view) {
        [dropzoneView, progressView, resultsView].forEach(function (v) { v.classList.add('hidden'); });
        view.classList.remove('hidden');
    }

    function resetToDropzone() {
        showView(dropzoneView);
        clearError();
        fileInput.value = '';
        progressBar.style.width = '0%';
    }

    function handleFile(file) {
        clearError();

        if (!file) return;
        if (!/\.zip$/i.test(file.name)) {
            showError('Please choose a .zip file (a Salesforce Metadata API retrieve package).');
            return;
        }

        showView(progressView);
        progressLabel.textContent = 'Reading ZIP…';
        progressBar.style.width = '0%';
        progressCount.textContent = '';

        var worker = new Worker('/static/metadata-kb-worker.js');

        worker.onmessage = function (e) {
            var msg = e.data;
            if (msg.type === 'progress') {
                var pct = msg.total > 0 ? Math.round((msg.done / msg.total) * 100) : 0;
                progressBar.style.width = pct + '%';
                progressLabel.textContent = 'Parsing ' + msg.label + '…';
                progressCount.textContent = msg.done + ' / ' + msg.total + ' files';
            } else if (msg.type === 'done') {
                currentMarkdown = msg.markdown;
                currentStats = msg.stats;
                renderResults(file.name, msg.stats, msg.markdown);
                worker.terminate();
            } else if (msg.type === 'error') {
                showError(msg.message || 'Something went wrong while parsing this ZIP.');
                showView(dropzoneView);
                worker.terminate();
            }
        };

        worker.onerror = function (err) {
            showError('Worker error: ' + (err.message || 'failed to parse the ZIP.'));
            showView(dropzoneView);
            worker.terminate();
        };

        file.arrayBuffer().then(function (buffer) {
            worker.postMessage({ fileName: file.name, buffer: buffer }, [buffer]);
        }).catch(function (err) {
            showError('Could not read the file: ' + err.message);
            showView(dropzoneView);
        });
    }

    function renderResults(fileName, stats, markdown) {
        resultFileName.textContent = fileName;

        var c = stats.counts;
        var tiles = [
            { label: 'Custom Objects', value: c.objects },
            { label: 'Platform Events', value: c.events },
            { label: 'Flows', value: c.flows },
            { label: 'Apex Classes', value: c.classes },
            { label: 'Apex Triggers', value: c.triggers },
            { label: 'LWC', value: c.lwc },
            { label: 'Aura', value: c.aura },
            { label: 'Profiles', value: c.profiles },
        ];
        summaryGrid.innerHTML = tiles.map(function (t) {
            return '<div class="text-center bg-gray-50 dark:bg-gray-900/50 rounded-lg py-3">' +
                '<div class="text-xl font-bold text-primary-600 dark:text-primary-400">' + t.value + '</div>' +
                '<div class="text-xs text-gray-500 dark:text-gray-400">' + t.label + '</div>' +
                '</div>';
        }).join('');

        mdPreview.textContent = markdown;
        showView(resultsView);
    }

    // ── Drop zone wiring ─────────────────────────────────────────────────────
    dropzone.addEventListener('click', function () { fileInput.click(); });

    fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    ['dragenter', 'dragover'].forEach(function (evt) {
        dropzone.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dropzone-active');
        });
    });

    ['dragleave', 'drop'].forEach(function (evt) {
        dropzone.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dropzone-active');
        });
    });

    dropzone.addEventListener('drop', function (e) {
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files[0]) handleFile(files[0]);
    });

    // ── Actions ──────────────────────────────────────────────────────────────
    btnDownload.addEventListener('click', function () {
        var blob = new Blob([currentMarkdown], { type: 'text/markdown;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'salesforce-metadata-kb.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    btnCopy.addEventListener('click', function () {
        var restoreLabel = btnCopy.innerHTML;
        function flash(text) {
            btnCopy.innerHTML = text;
            setTimeout(function () { btnCopy.innerHTML = restoreLabel; }, 1800);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(currentMarkdown)
                .then(function () { flash('✅ Copied!'); })
                .catch(function () { flash('⚠ Copy failed — select text manually'); });
        } else {
            var ta = document.createElement('textarea');
            ta.value = currentMarkdown;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
                flash('✅ Copied!');
            } catch (e) {
                flash('⚠ Copy failed — select text manually');
            }
            document.body.removeChild(ta);
        }
    });

    btnStartOver.addEventListener('click', resetToDropzone);
})();
