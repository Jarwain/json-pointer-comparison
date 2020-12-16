'use strict';

let fs = require('fs');
let path = require('path');
let util = require('util');
let _ = require('lodash');
let columnify = require('columnify');

let {JsonPointer: ptr} = require('json-ptr');
let ptr0 = require('json-pointer');
let ptr1 = require('jsonpointer');

let format = util.format;

const COMPARISON_CYCLES = 10;
const RANDOM_POINTER_COUNT = 100000;
const NEWLINE = require('os').EOL;

let modules = [{
  name: 'json-ptr',
  module: ptr,
  flatten: 'flatten',
  compile: 'create',
  compiled: {
    has: 'has',
    get: 'get',
    set: 'set'
  },
  has: 'has',
  get: 'get',
  set: 'set'
}, {
  name: 'json-pointer',
  module: ptr0,
  flatten: 'dict',
  has: 'has',
  get: 'get',
  set: 'set'
}, {
  name: 'jsonpointer',
  module: ptr1,
  compile: 'compile',
  compiled: {
    get: 'get',
    set: 'set'
  },
  get: 'get',
  set: 'set'
}];

function timed(report, action, module, operation, compiled, ops) {
  var duration = '',
    ea = '',
    err;
  ops = ops || 1;
  let beg = process.hrtime();
  try {
    action();
    let time = process.hrtime(beg);
    duration = time[0] * 1e9 + time[1]; // # of nanoseconds
    ea = duration / ops;
  } catch (e) {
    err = e;
  }
  report.push({
    module, operation, compiled, duration: duration, ops, ea, err
  });
}

function loadFile(file, callback) {
  fs.access(file, fs.R_OK, (err) => {
    if (err) {
      callback(err);
      return;
    }
    fs.readFile(file, 'utf8', (err, raw) => {
      try {
        callback(null, JSON.parse(raw));
      } catch (err) {
        callback(err);
      }
    });
  });
}

function takeRandomPointers(pointers, n) {
  var res = [];
  while (res.length < n) {
    let rand = Math.floor((Math.random() * pointers.length));
    let p = ptr.create(pointers[rand].pointer);
    let item = {
      pointer: p.pointer,
      fragmentId: p.uriFragmentIdentifier,
      compiled: {}
    };
    // for each module, let it prepare/compile a pointer if it has
    // such capability. Theoretically, the pre-compiled pointers should be
    // faster.
    modules.forEach(m => {
      if (m.compile) {
        item.compiled[m.name] = m.module[m.compile](p.pointer);
      }
    });
    res.push(item);
  }
  return res;
}

let comparisonReportOptions = {
  columnSplitter: ' | ',
  config: {
    duration: {
      align: 'right'
    },
    ops: {
      align: 'right'
    },
    ea: {
      align: 'right'
    }
  }
};

let summaryReportOptions = {
  columnSplitter: ' | ',
  config: {
    avg: {
      align: 'right'
    },
    slower: {
      align: 'right'
    }
  }
};

function summarize(report, operation) {
  var summary = [];

  modules.forEach(m => {
    if (m[operation]) {
      let samples = _.where(report, {
        module: m.name,
        compiled: false
      });
      let combined = _.sum(samples, 'ea');
      summary.push({
        module: m.name,
        method: m[operation],
        compiled: '',
        samples: samples.length * samples[0].ops,
        avg: Math.round(combined / samples.length),
        slower: ''
      });
    } else {
      summary.push({
        module: m.name,
        method: 'n/a',
        compiled: '',
        samples: '-',
        avg: '-',
        slower: ''
      });
    }
    if (m.compiled && m.compiled[operation]) {
      let samples = _.where(report, {
        module: m.name,
        compiled: true
      });
      let combined = _.sum(samples, 'ea');
      summary.push({
        module: m.name,
        method: m.compiled[operation],
        compiled: 'compiled',
        samples: samples.length * samples[0].ops,
        avg: Math.round(combined / samples.length),
        slower: ''
      });
    }
  });
  summary = _.sortBy(summary, 'avg');
  _.rest(summary).forEach(sample => {
    if (typeof (sample.avg) === 'number') {
      sample.slower = format('%d%%', ((sample.avg - summary[0].avg) / summary[0].avg * 100).toFixed(2));
    }
  });
  console.log(NEWLINE + columnify(summary, summaryReportOptions) + NEWLINE);
}

function compareFlatten(data) {
  var report = [];
  console.log(NEWLINE + '.flatten(obj)');
  for (let i = 0; i < COMPARISON_CYCLES; ++i) {
    modules.forEach(m => { // eslint-disable-line no-loop-func
      if (m.flatten) {
        timed(report, m.module[m.flatten].bind(m.module, data), m.name, '.' + m.flatten + '(data)', false);
      }
    });
  }
  console.log(NEWLINE + columnify(report, comparisonReportOptions));
  summarize(report, 'flatten');
}

function compareEa(data, pointers, pprop, method, description) {
  var report = [];
  console.log(description);
  for (let i = 0; i < COMPARISON_CYCLES; ++i) {
    modules.forEach(m => { // eslint-disable-line no-loop-func
      if (m[method]) {
        let callable = m.module[m[method]].bind(m.module);
        timed(report, function() {
          for (let i = 0; i < pointers.length; ++i) {
            callable(data, pointers[i][pprop]);
          }
        }, m.name, '.' + m[method] + '(data, ' + pprop + ')', false, pointers.length);
      }
      if (m.compile && m.compiled[method]) {
        let compiledMethodName = m.compiled[method];
        timed(report, function() {
          for (let i = 0; i < pointers.length; ++i) {
            pointers[i].compiled[m.name][compiledMethodName](data);
          }
        }, m.name, '.' + m[method] + '(data)', true, pointers.length);
      }
    });
  }
  console.log(columnify(report, comparisonReportOptions));
  summarize(report, method);
}

function performComparisons(data, pointers) {

  // flatten
  compareFlatten(data);

  // has
  compareEa(data, pointers, 'pointer', 'has', '.has(obj, pointer)');

  // has
  compareEa(data, pointers, 'pointer', 'has', '.has(obj, fragmentId)');

  // get
  compareEa(data, pointers, 'pointer', 'get', '.get(obj, pointer)');

  // get
  compareEa(data, pointers, 'pointer', 'get', '.get(obj, fragmentId)');

}

let dataFile = path.resolve(path.join(__dirname, './zips.json'));

loadFile(dataFile, (err, data) => {
  if (err) {
    console.log(util.inspect(err, false, 9));
    return;
  }
  performComparisons(data,
    takeRandomPointers(ptr.listPointers(data), RANDOM_POINTER_COUNT)
  );
});
