import * as grpcWeb from 'grpc-web';

import * as clusterdoctor_pb from './clusterdoctor_pb'; // proto import: "clusterdoctor.proto"


export class ClusterDoctorServiceClient {
  constructor (hostname: string,
               credentials?: null | { [index: string]: string; },
               options?: null | { [index: string]: any; });

  getClusterReport(
    request: clusterdoctor_pb.ClusterReportRequest,
    metadata: grpcWeb.Metadata | undefined,
    callback: (err: grpcWeb.RpcError,
               response: clusterdoctor_pb.ClusterReport) => void
  ): grpcWeb.ClientReadableStream<clusterdoctor_pb.ClusterReport>;

  getNodeReport(
    request: clusterdoctor_pb.NodeReportRequest,
    metadata: grpcWeb.Metadata | undefined,
    callback: (err: grpcWeb.RpcError,
               response: clusterdoctor_pb.NodeReport) => void
  ): grpcWeb.ClientReadableStream<clusterdoctor_pb.NodeReport>;

  getDriftReport(
    request: clusterdoctor_pb.DriftReportRequest,
    metadata: grpcWeb.Metadata | undefined,
    callback: (err: grpcWeb.RpcError,
               response: clusterdoctor_pb.DriftReport) => void
  ): grpcWeb.ClientReadableStream<clusterdoctor_pb.DriftReport>;

  explainFinding(
    request: clusterdoctor_pb.ExplainFindingRequest,
    metadata: grpcWeb.Metadata | undefined,
    callback: (err: grpcWeb.RpcError,
               response: clusterdoctor_pb.FindingExplanation) => void
  ): grpcWeb.ClientReadableStream<clusterdoctor_pb.FindingExplanation>;

}

export class ClusterDoctorServicePromiseClient {
  constructor (hostname: string,
               credentials?: null | { [index: string]: string; },
               options?: null | { [index: string]: any; });

  getClusterReport(
    request: clusterdoctor_pb.ClusterReportRequest,
    metadata?: grpcWeb.Metadata
  ): Promise<clusterdoctor_pb.ClusterReport>;

  getNodeReport(
    request: clusterdoctor_pb.NodeReportRequest,
    metadata?: grpcWeb.Metadata
  ): Promise<clusterdoctor_pb.NodeReport>;

  getDriftReport(
    request: clusterdoctor_pb.DriftReportRequest,
    metadata?: grpcWeb.Metadata
  ): Promise<clusterdoctor_pb.DriftReport>;

  explainFinding(
    request: clusterdoctor_pb.ExplainFindingRequest,
    metadata?: grpcWeb.Metadata
  ): Promise<clusterdoctor_pb.FindingExplanation>;

}

