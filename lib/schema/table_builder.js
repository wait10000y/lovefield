/**
 * @license
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
goog.provide('lf.schema.TableBuilder');

goog.require('goog.structs.Map');
goog.require('goog.structs.Set');
goog.require('lf.Exception');
goog.require('lf.Order');
goog.require('lf.Row');
goog.require('lf.Type');
goog.require('lf.schema.BaseColumn');
goog.require('lf.schema.Constraint');
goog.require('lf.schema.Index');
goog.require('lf.schema.Table');
goog.require('lf.type');



/**
 * Dynamic Table schema builder.
 * @constructor
 *
 * @param {string} tableName
 */
lf.schema.TableBuilder = function(tableName) {
  /** @private {string} */
  this.name_ = tableName;

  /** @private {!goog.structs.Map.<string, !lf.Type>} */
  this.columns_ = new goog.structs.Map();

  /** @private {!goog.structs.Set.<string>} */
  this.uniqueColumns_ = new goog.structs.Set();

  /** @private {!goog.structs.Set.<string>} */
  this.uniqueIndices_ = new goog.structs.Set();

  /** @private {!goog.structs.Set.<string>} */
  this.nullable_ = new goog.structs.Set();

  /** @private {string} */
  this.pkName_ = 'pk' + lf.schema.TableBuilder.toPascal_(this.name_);

  /** @private {!goog.structs.Map.<string, !Array<!lf.schema.IndexedColumn>>} */
  this.indices_ = new goog.structs.Map();

  /** @private {boolean} */
  this.persistIndex_ = false;

  this.checkName_(tableName);
};


/**
 * @param {string} name
 * @return {string}
 * @private
 * @see http://en.wikipedia.org/wiki/CamelCase
 */
lf.schema.TableBuilder.toPascal_ = function(name) {
  return name[0].toUpperCase() + name.substring(1);
};


/**
 * @param {string} name
 * @private
 */
lf.schema.TableBuilder.prototype.checkName_ = function(name) {
  if (!(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
    throw new lf.Exception(lf.Exception.Type.SYNTAX,
        name + ' violates naming rule');
  }
  if (this.columns_.containsKey(name) ||
      this.indices_.containsKey(name) ||
      this.uniqueIndices_.contains(name)) {
    throw new lf.Exception(lf.Exception.Type.SYNTAX,
        this.name_ + '.' + name + ' is already defined');
  }
};


/**
 * @param {string} name
 * @param {!lf.Type} type
 * @return {!lf.schema.TableBuilder}
 */
lf.schema.TableBuilder.prototype.addColumn = function(name, type) {
  this.checkName_(name);
  this.columns_.set(name, type);
  return this;
};


/**
 * @param {(!Array<string>|!Array<!lf.schema.IndexedColumn>)} columns
 * @param {boolean=} opt_autoInc
 * @return {!lf.schema.TableBuilder}
 */
lf.schema.TableBuilder.prototype.addPrimaryKey = function(
    columns, opt_autoInc) {
  this.checkName_(this.pkName_);
  var cols = this.normalizeColumns_(columns, true, undefined, opt_autoInc);
  cols.forEach(function(col) {
    this.uniqueColumns_.add(col.name);
  }, this);
  this.uniqueIndices_.add(this.pkName_);
  this.indices_.set(this.pkName_, cols);
  return this;
};


/**
 * @param {string} name
 * @param {string} localColumn
 * @param {string} remoteTable
 * @param {string} remoteColumn
 * @param {boolean=} opt_cascade
 * @return {!lf.schema.TableBuilder}
 */
lf.schema.TableBuilder.prototype.addForeignKey = function(
    name, localColumn, remoteTable, remoteColumn, opt_cascade) {
  // TODO(arthurhsu): implement.
  return this;
};


/**
 * @param {string} name
 * @param {!Array<string>} columns
 * @return {!lf.schema.TableBuilder}
 */
lf.schema.TableBuilder.prototype.addUnique = function(name, columns) {
  this.checkName_(name);
  var cols = this.normalizeColumns_(columns, true);
  this.indices_.set(name, cols);
  this.uniqueIndices_.add(name);
  return this;
};


/**
 * @param {!Array<string>} columns
 * @return {!lf.schema.TableBuilder}
 */
lf.schema.TableBuilder.prototype.addNullable = function(columns) {
  var cols = this.normalizeColumns_(columns, false);
  cols.forEach(function(col) {
    this.nullable_.add(col.name);
  }, this);
  return this;
};


/**
 * Mimics SQL CREATE INDEX.
 * @param {string} name
 * @param {!Array<string> | !Array<lf.schema.IndexedColumn>} columns
 * @param {!lf.Order=} opt_order Order of columns, only effective when columns
 *     are array of strings.
 * @param {boolean=} opt_unique Whether the index is unique, default is false.
 * @return {!lf.schema.TableBuilder}
 */
lf.schema.TableBuilder.prototype.addIndex = function(
    name, columns, opt_order, opt_unique) {
  this.checkName_(name);
  var cols = this.normalizeColumns_(columns, true, opt_order);
  if (opt_unique) {
    this.uniqueIndices_.add(name);
  }
  this.indices_.set(name, cols);
  return this;
};


/** @param {boolean} value */
lf.schema.TableBuilder.prototype.persistIndex = function(value) {
  this.persistIndex_ = value;
};


/** @return {!lf.schema.Table} */
lf.schema.TableBuilder.prototype.getSchema = function() {
  var tableClass = this.generateTableClass_();
  return new tableClass();
};


/**
 * Convert different column representations (column name only or column objects)
 * into column object array. Also performs consistency check to make sure
 * referred columns are actually defined.
 * @param {(!Array<string>|!Array<!lf.schema.IndexedColumn>)} columns
 * @param {boolean} checkIndexable
 * @param {!lf.Order=} opt_order
 * @param {boolean=} opt_autoInc
 * @return {!Array<!lf.schema.IndexedColumn>} Normalized columns
 * @private
 */
lf.schema.TableBuilder.prototype.normalizeColumns_ = function(
    columns, checkIndexable, opt_order, opt_autoInc) {
  var normalized = columns;
  if (typeof(columns[0]) == 'string') {
    normalized = columns.map(function(col) {
      return {
        'name': col,
        'order': opt_order || lf.Order.ASC,
        'autoIncrement': opt_autoInc || false
      };
    });
  }

  normalized.forEach(function(col) {
    if (!this.columns_.containsKey(col.name)) {
      throw new lf.Exception(
          lf.Exception.Type.SYNTAX,
          this.name_ + ' does not have column: ' + col.name);
    }
    if (checkIndexable) {
      var type = this.columns_.get(col.name);
      if (type == lf.Type.ARRAY_BUFFER || type == lf.Type.OBJECT) {
        throw new lf.Exception(
            lf.Exception.Type.SYNTAX,
            this.name_ + ' index on non-indexable column: ' + col.name);
      }
    }
  }, this);

  return normalized;
};


/**
 * @return {!Function}
 * @private
 */
lf.schema.TableBuilder.prototype.generateTableClass_ = function() {
  var indices = this.indices_.getKeys().map(function(indexName) {
    return new lf.schema.Index(
        this.name_,
        indexName,
        this.uniqueIndices_.contains(indexName),
        this.indices_.get(indexName));
  }, this);
  var that = this;

  /**
   * @constructor
   * @extends {lf.schema.Table}
   */
  var tableClass = function() {
    /** @private {!Array<!lf.schema.Column>} */
    this.cols_ = that.columns_.getKeys().map(function(colName) {
      this[colName] = new lf.schema.BaseColumn(
          this,
          colName,
          that.uniqueColumns_.contains(colName),
          that.columns_.get(colName));
      return this[colName];
    }, this);
    tableClass.base(
        this, 'constructor',
        that.name_, this.cols_, indices, that.persistIndex_);

    var pk = that.indices_.containsKey(that.pkName_) ?
        new lf.schema.Index(
        that.name_, that.pkName_, true, that.indices_.get(that.pkName_)) :
        null;
    var notNullable = this.cols_.filter(function(col) {
      return !that.nullable_.contains(col.getName());
    });
    var foreignKeys = [];
    var unique = that.uniqueIndices_.getValues().map(function(indexName) {
      return new lf.schema.Index(
          that.name_, indexName, true, that.indices_.get(indexName));
    });

    /** @private {!lf.schema.Constraint} */
    this.constraint_ =
        new lf.schema.Constraint(pk, notNullable, foreignKeys, unique);

    /** @private {!Function} */
    this.rowClass_ = that.generateRowClass_(this.cols_, indices);
  };
  goog.inherits(tableClass, lf.schema.Table);

  /** @override */
  tableClass.prototype.createRow = function(opt_value) {
    return new this.rowClass_(lf.Row.getNextId(), opt_value);
  };

  /** @override */
  tableClass.prototype.deserializeRow = function(dbRecord) {
    var obj = {};
    this.cols_.forEach(function(col) {
      var key = col.getName();
      var type = col.getType();
      var value = dbRecord['value'][key];
      if (type == lf.Type.ARRAY_BUFFER) {
        obj[key] = goog.isNull(value) ? value : lf.Row.hexToBin(value);
      } else if (type == lf.Type.DATE_TIME) {
        obj[key] = goog.isNull(value) ? value : new Date(value);
      } else {
        obj[key] = value;
      }
    }, this);
    return new this.rowClass_(dbRecord['id'], obj);
  };

  /** @override */
  tableClass.prototype.getConstraint = function() {
    return this.constraint_;
  };

  return tableClass;
};


/**
 * @param {!Array<!lf.schema.Column>} columns
 * @param {!Array<!lf.schema.Index>} indices
 * @return {!Function}
 * @private
 */
lf.schema.TableBuilder.prototype.generateRowClass_ = function(
    columns, indices) {
  /**
   * @param {number} rowId
   * @param {!Object=} opt_payload
   * @extends {lf.Row}
   * @constructor
   */
  var rowClass = function(rowId, opt_payload) {
    /** @private {!Array<!lf.schema.Column>} */
    this.columns_ = columns;

    /** @private {!Array<!lf.schema.Index>} */
    this.indices_ = indices;

    // Placed here so that defaultPayload() can run correctly.
    rowClass.base(this, 'constructor', rowId, opt_payload);
  };
  goog.inherits(rowClass, lf.Row);

  /** @override */
  rowClass.prototype.defaultPayload = function() {
    var obj = {};
    this.columns_.forEach(function(col) {
      obj[col.getName()] = lf.type.DEFAULT_VALUES[col.getType()];
    });
    return obj;
  };

  /** @override */
  rowClass.prototype.toDbPayload = function() {
    var obj = {};
    this.columns_.forEach(function(col) {
      var key = col.getName();
      var type = col.getType();
      var value = this.payload()[key];
      if (type == lf.Type.ARRAY_BUFFER) {
        obj[key] = goog.isNull(value) ? value : lf.Row.binToHex(value);
      } else if (type == lf.Type.DATE_TIME) {
        obj[key] = goog.isNull(value) ? value : value.getTime();
      } else {
        obj[key] = value;
      }
    }, this);
    return obj;
  };

  var functionMap = {};
  indices.forEach(function(index) {
    // TODO(arthurhsu): add multi-column support.
    //     see https://github.com/google/lovefield/issues/15
    var firstColumnName = index.columns[0].name;
    var key = index.getNormalizedName();
    if (this.columns_.get(firstColumnName) == lf.Type.DATE_TIME) {
      functionMap[key] = function(payload) {
        return payload[firstColumnName].getTime();
      };
    } else {
      functionMap[key] = function(payload) {
        return payload[firstColumnName];
      };
    }
  }, this);

  /** @override */
  rowClass.prototype.keyOfIndex = function(indexName) {
    if (indexName.indexOf('#') != -1) {
      return /** @type {!lf.index.Index.Key} */ (this.id());
    }
    if (functionMap.hasOwnProperty(indexName)) {
      var payload = this.payload();
      return functionMap[indexName](payload);
    }
    return null;
  };

  return rowClass;
};
