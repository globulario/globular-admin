import * as jspb from 'google-protobuf'

import * as google_protobuf_timestamp_pb from 'google-protobuf/google/protobuf/timestamp_pb'; // proto import: "google/protobuf/timestamp.proto"


export class ReportHeader extends jspb.Message {
  getGeneratedAt(): google_protobuf_timestamp_pb.Timestamp | undefined;
  setGeneratedAt(value?: google_protobuf_timestamp_pb.Timestamp): ReportHeader;
  hasGeneratedAt(): boolean;
  clearGeneratedAt(): ReportHeader;

  getSnapshotId(): string;
  setSnapshotId(value: string): ReportHeader;

  getGlobularVersion(): string;
  setGlobularVersion(value: string): ReportHeader;

  getDataSourcesList(): Array<string>;
  setDataSourcesList(value: Array<string>): ReportHeader;
  clearDataSourcesList(): ReportHeader;
  addDataSources(value: string, index?: number): ReportHeader;

  getDataIncomplete(): boolean;
  setDataIncomplete(value: boolean): ReportHeader;

  getDataErrorsList(): Array<Evidence>;
  setDataErrorsList(value: Array<Evidence>): ReportHeader;
  clearDataErrorsList(): ReportHeader;
  addDataErrors(value?: Evidence, index?: number): Evidence;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ReportHeader.AsObject;
  static toObject(includeInstance: boolean, msg: ReportHeader): ReportHeader.AsObject;
  static serializeBinaryToWriter(message: ReportHeader, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ReportHeader;
  static deserializeBinaryFromReader(message: ReportHeader, reader: jspb.BinaryReader): ReportHeader;
}

export namespace ReportHeader {
  export type AsObject = {
    generatedAt?: google_protobuf_timestamp_pb.Timestamp.AsObject,
    snapshotId: string,
    globularVersion: string,
    dataSourcesList: Array<string>,
    dataIncomplete: boolean,
    dataErrorsList: Array<Evidence.AsObject>,
  }
}

export class Evidence extends jspb.Message {
  getSourceService(): string;
  setSourceService(value: string): Evidence;

  getSourceRpc(): string;
  setSourceRpc(value: string): Evidence;

  getKeyValuesMap(): jspb.Map<string, string>;
  clearKeyValuesMap(): Evidence;

  getTimestamp(): google_protobuf_timestamp_pb.Timestamp | undefined;
  setTimestamp(value?: google_protobuf_timestamp_pb.Timestamp): Evidence;
  hasTimestamp(): boolean;
  clearTimestamp(): Evidence;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): Evidence.AsObject;
  static toObject(includeInstance: boolean, msg: Evidence): Evidence.AsObject;
  static serializeBinaryToWriter(message: Evidence, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): Evidence;
  static deserializeBinaryFromReader(message: Evidence, reader: jspb.BinaryReader): Evidence;
}

export namespace Evidence {
  export type AsObject = {
    sourceService: string,
    sourceRpc: string,
    keyValuesMap: Array<[string, string]>,
    timestamp?: google_protobuf_timestamp_pb.Timestamp.AsObject,
  }
}

export class RemediationStep extends jspb.Message {
  getOrder(): number;
  setOrder(value: number): RemediationStep;

  getDescription(): string;
  setDescription(value: string): RemediationStep;

  getCliCommand(): string;
  setCliCommand(value: string): RemediationStep;

  getFutureActionId(): string;
  setFutureActionId(value: string): RemediationStep;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): RemediationStep.AsObject;
  static toObject(includeInstance: boolean, msg: RemediationStep): RemediationStep.AsObject;
  static serializeBinaryToWriter(message: RemediationStep, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): RemediationStep;
  static deserializeBinaryFromReader(message: RemediationStep, reader: jspb.BinaryReader): RemediationStep;
}

export namespace RemediationStep {
  export type AsObject = {
    order: number,
    description: string,
    cliCommand: string,
    futureActionId: string,
  }
}

export class Finding extends jspb.Message {
  getFindingId(): string;
  setFindingId(value: string): Finding;

  getInvariantId(): string;
  setInvariantId(value: string): Finding;

  getSeverity(): Severity;
  setSeverity(value: Severity): Finding;

  getCategory(): string;
  setCategory(value: string): Finding;

  getEntityRef(): string;
  setEntityRef(value: string): Finding;

  getSummary(): string;
  setSummary(value: string): Finding;

  getEvidenceList(): Array<Evidence>;
  setEvidenceList(value: Array<Evidence>): Finding;
  clearEvidenceList(): Finding;
  addEvidence(value?: Evidence, index?: number): Evidence;

  getRemediationList(): Array<RemediationStep>;
  setRemediationList(value: Array<RemediationStep>): Finding;
  clearRemediationList(): Finding;
  addRemediation(value?: RemediationStep, index?: number): RemediationStep;

  getInvariantStatus(): InvariantStatus;
  setInvariantStatus(value: InvariantStatus): Finding;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): Finding.AsObject;
  static toObject(includeInstance: boolean, msg: Finding): Finding.AsObject;
  static serializeBinaryToWriter(message: Finding, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): Finding;
  static deserializeBinaryFromReader(message: Finding, reader: jspb.BinaryReader): Finding;
}

export namespace Finding {
  export type AsObject = {
    findingId: string,
    invariantId: string,
    severity: Severity,
    category: string,
    entityRef: string,
    summary: string,
    evidenceList: Array<Evidence.AsObject>,
    remediationList: Array<RemediationStep.AsObject>,
    invariantStatus: InvariantStatus,
  }
}

export class ClusterReportRequest extends jspb.Message {
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ClusterReportRequest.AsObject;
  static toObject(includeInstance: boolean, msg: ClusterReportRequest): ClusterReportRequest.AsObject;
  static serializeBinaryToWriter(message: ClusterReportRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ClusterReportRequest;
  static deserializeBinaryFromReader(message: ClusterReportRequest, reader: jspb.BinaryReader): ClusterReportRequest;
}

export namespace ClusterReportRequest {
  export type AsObject = {
  }
}

export class ClusterReport extends jspb.Message {
  getHeader(): ReportHeader | undefined;
  setHeader(value?: ReportHeader): ClusterReport;
  hasHeader(): boolean;
  clearHeader(): ClusterReport;

  getOverallStatus(): ClusterStatus;
  setOverallStatus(value: ClusterStatus): ClusterReport;

  getFindingsList(): Array<Finding>;
  setFindingsList(value: Array<Finding>): ClusterReport;
  clearFindingsList(): ClusterReport;
  addFindings(value?: Finding, index?: number): Finding;

  getCountsByCategoryMap(): jspb.Map<string, number>;
  clearCountsByCategoryMap(): ClusterReport;

  getTopIssueIdsList(): Array<string>;
  setTopIssueIdsList(value: Array<string>): ClusterReport;
  clearTopIssueIdsList(): ClusterReport;
  addTopIssueIds(value: string, index?: number): ClusterReport;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ClusterReport.AsObject;
  static toObject(includeInstance: boolean, msg: ClusterReport): ClusterReport.AsObject;
  static serializeBinaryToWriter(message: ClusterReport, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ClusterReport;
  static deserializeBinaryFromReader(message: ClusterReport, reader: jspb.BinaryReader): ClusterReport;
}

export namespace ClusterReport {
  export type AsObject = {
    header?: ReportHeader.AsObject,
    overallStatus: ClusterStatus,
    findingsList: Array<Finding.AsObject>,
    countsByCategoryMap: Array<[string, number]>,
    topIssueIdsList: Array<string>,
  }
}

export class NodeReportRequest extends jspb.Message {
  getNodeId(): string;
  setNodeId(value: string): NodeReportRequest;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): NodeReportRequest.AsObject;
  static toObject(includeInstance: boolean, msg: NodeReportRequest): NodeReportRequest.AsObject;
  static serializeBinaryToWriter(message: NodeReportRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): NodeReportRequest;
  static deserializeBinaryFromReader(message: NodeReportRequest, reader: jspb.BinaryReader): NodeReportRequest;
}

export namespace NodeReportRequest {
  export type AsObject = {
    nodeId: string,
  }
}

export class NodeReport extends jspb.Message {
  getHeader(): ReportHeader | undefined;
  setHeader(value?: ReportHeader): NodeReport;
  hasHeader(): boolean;
  clearHeader(): NodeReport;

  getNodeId(): string;
  setNodeId(value: string): NodeReport;

  getReachable(): boolean;
  setReachable(value: boolean): NodeReport;

  getHeartbeatAgeSeconds(): number;
  setHeartbeatAgeSeconds(value: number): NodeReport;

  getFindingsList(): Array<Finding>;
  setFindingsList(value: Array<Finding>): NodeReport;
  clearFindingsList(): NodeReport;
  addFindings(value?: Finding, index?: number): Finding;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): NodeReport.AsObject;
  static toObject(includeInstance: boolean, msg: NodeReport): NodeReport.AsObject;
  static serializeBinaryToWriter(message: NodeReport, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): NodeReport;
  static deserializeBinaryFromReader(message: NodeReport, reader: jspb.BinaryReader): NodeReport;
}

export namespace NodeReport {
  export type AsObject = {
    header?: ReportHeader.AsObject,
    nodeId: string,
    reachable: boolean,
    heartbeatAgeSeconds: number,
    findingsList: Array<Finding.AsObject>,
  }
}

export class DriftReportRequest extends jspb.Message {
  getNodeId(): string;
  setNodeId(value: string): DriftReportRequest;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): DriftReportRequest.AsObject;
  static toObject(includeInstance: boolean, msg: DriftReportRequest): DriftReportRequest.AsObject;
  static serializeBinaryToWriter(message: DriftReportRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): DriftReportRequest;
  static deserializeBinaryFromReader(message: DriftReportRequest, reader: jspb.BinaryReader): DriftReportRequest;
}

export namespace DriftReportRequest {
  export type AsObject = {
    nodeId: string,
  }
}

export class DriftItem extends jspb.Message {
  getNodeId(): string;
  setNodeId(value: string): DriftItem;

  getEntityRef(): string;
  setEntityRef(value: string): DriftItem;

  getCategory(): DriftCategory;
  setCategory(value: DriftCategory): DriftItem;

  getDesired(): string;
  setDesired(value: string): DriftItem;

  getActual(): string;
  setActual(value: string): DriftItem;

  getEvidenceList(): Array<Evidence>;
  setEvidenceList(value: Array<Evidence>): DriftItem;
  clearEvidenceList(): DriftItem;
  addEvidence(value?: Evidence, index?: number): Evidence;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): DriftItem.AsObject;
  static toObject(includeInstance: boolean, msg: DriftItem): DriftItem.AsObject;
  static serializeBinaryToWriter(message: DriftItem, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): DriftItem;
  static deserializeBinaryFromReader(message: DriftItem, reader: jspb.BinaryReader): DriftItem;
}

export namespace DriftItem {
  export type AsObject = {
    nodeId: string,
    entityRef: string,
    category: DriftCategory,
    desired: string,
    actual: string,
    evidenceList: Array<Evidence.AsObject>,
  }
}

export class DriftReport extends jspb.Message {
  getHeader(): ReportHeader | undefined;
  setHeader(value?: ReportHeader): DriftReport;
  hasHeader(): boolean;
  clearHeader(): DriftReport;

  getItemsList(): Array<DriftItem>;
  setItemsList(value: Array<DriftItem>): DriftReport;
  clearItemsList(): DriftReport;
  addItems(value?: DriftItem, index?: number): DriftItem;

  getTotalDriftCount(): number;
  setTotalDriftCount(value: number): DriftReport;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): DriftReport.AsObject;
  static toObject(includeInstance: boolean, msg: DriftReport): DriftReport.AsObject;
  static serializeBinaryToWriter(message: DriftReport, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): DriftReport;
  static deserializeBinaryFromReader(message: DriftReport, reader: jspb.BinaryReader): DriftReport;
}

export namespace DriftReport {
  export type AsObject = {
    header?: ReportHeader.AsObject,
    itemsList: Array<DriftItem.AsObject>,
    totalDriftCount: number,
  }
}

export class ExplainFindingRequest extends jspb.Message {
  getFindingId(): string;
  setFindingId(value: string): ExplainFindingRequest;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ExplainFindingRequest.AsObject;
  static toObject(includeInstance: boolean, msg: ExplainFindingRequest): ExplainFindingRequest.AsObject;
  static serializeBinaryToWriter(message: ExplainFindingRequest, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ExplainFindingRequest;
  static deserializeBinaryFromReader(message: ExplainFindingRequest, reader: jspb.BinaryReader): ExplainFindingRequest;
}

export namespace ExplainFindingRequest {
  export type AsObject = {
    findingId: string,
  }
}

export class FindingExplanation extends jspb.Message {
  getFindingId(): string;
  setFindingId(value: string): FindingExplanation;

  getInvariantId(): string;
  setInvariantId(value: string): FindingExplanation;

  getWhyFailed(): string;
  setWhyFailed(value: string): FindingExplanation;

  getRemediationList(): Array<RemediationStep>;
  setRemediationList(value: Array<RemediationStep>): FindingExplanation;
  clearRemediationList(): FindingExplanation;
  addRemediation(value?: RemediationStep, index?: number): RemediationStep;

  getEvidenceList(): Array<Evidence>;
  setEvidenceList(value: Array<Evidence>): FindingExplanation;
  clearEvidenceList(): FindingExplanation;
  addEvidence(value?: Evidence, index?: number): Evidence;

  getPlanRisk(): PlanRisk;
  setPlanRisk(value: PlanRisk): FindingExplanation;

  getPlanDiffList(): Array<string>;
  setPlanDiffList(value: Array<string>): FindingExplanation;
  clearPlanDiffList(): FindingExplanation;
  addPlanDiff(value: string, index?: number): FindingExplanation;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): FindingExplanation.AsObject;
  static toObject(includeInstance: boolean, msg: FindingExplanation): FindingExplanation.AsObject;
  static serializeBinaryToWriter(message: FindingExplanation, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): FindingExplanation;
  static deserializeBinaryFromReader(message: FindingExplanation, reader: jspb.BinaryReader): FindingExplanation;
}

export namespace FindingExplanation {
  export type AsObject = {
    findingId: string,
    invariantId: string,
    whyFailed: string,
    remediationList: Array<RemediationStep.AsObject>,
    evidenceList: Array<Evidence.AsObject>,
    planRisk: PlanRisk,
    planDiffList: Array<string>,
  }
}

export enum Severity { 
  SEVERITY_UNKNOWN = 0,
  SEVERITY_INFO = 1,
  SEVERITY_WARN = 2,
  SEVERITY_ERROR = 3,
  SEVERITY_CRITICAL = 4,
}
export enum ClusterStatus { 
  CLUSTER_STATUS_UNKNOWN = 0,
  CLUSTER_HEALTHY = 1,
  CLUSTER_DEGRADED = 2,
  CLUSTER_CRITICAL = 3,
}
export enum DriftCategory { 
  DRIFT_UNKNOWN = 0,
  MISSING_UNIT_FILE = 1,
  UNIT_STOPPED = 2,
  UNIT_DISABLED = 3,
  VERSION_MISMATCH = 4,
  STATE_HASH_MISMATCH = 5,
  ENDPOINT_MISSING = 6,
  INVENTORY_INCOMPLETE = 7,
}
export enum PlanRisk { 
  PLAN_RISK_UNKNOWN = 0,
  PLAN_RISK_SAFE = 1,
  PLAN_RISK_MODERATE = 2,
  PLAN_RISK_DANGEROUS = 3,
}
export enum InvariantStatus { 
  INVARIANT_UNKNOWN = 0,
  INVARIANT_PASS = 1,
  INVARIANT_FAIL = 2,
  INVARIANT_PENDING = 3,
}
